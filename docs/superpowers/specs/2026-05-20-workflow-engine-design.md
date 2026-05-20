# Workflow Engine — Design Spec

**Date:** 2026-05-20
**Status:** Approved for implementation planning
**Scope:** Core engine v1. No HTTP/CLI/cron adapters, no persistence, no UI.

## Goal

A code-defined workflow engine, conceptually "n8n developer edition". Developers compose workflows from reusable single-responsibility nodes in plain TypeScript. Type safety is the top priority. No database. No DSL. No visual editor in scope (read-only UI may consume traces later).

## Decisions at a glance

| Concern | Choice |
|---|---|
| Control flow | Imperative — workflow is a plain async TS function |
| Context | Per-workflow typed bag (`Context<TBag>`) + local return values |
| Sub-workflow | Fresh bag, explicit input + return value, trace nests |
| Trigger | Programmatic only; HTTP/CLI/cron adapters out of scope for v1 |
| Error handling | Plain TS `try/catch`; engine records all failures to trace |
| Nodes | `@Injectable()` Nest providers, resolved via `ModuleRef` |
| Workflows | Plain async functions (not Nest providers) |
| Engine return | `{ result, trace }` on success; throws `WorkflowError` (with trace attached) on failure |
| Trace | In-memory only; engine returns it, caller persists if wanted |

## Architecture

Five pieces:

1. **`Node<I, O>`** — abstract class. Subclasses are `@Injectable()` Nest providers. Stateless. Single responsibility. Contract:
   ```ts
   abstract execute(input: I): Promise<O>;
   ```
   Nodes do not see the workflow context. Their deps come from their constructor (Nest DI). If a node needs to coordinate multiple operations, it is actually a workflow.

2. **Workflow** — plain async function. Not a Nest provider. Imported and passed by reference.
   ```ts
   type WorkflowFn<TIn, TOut, TBag = {}> =
     (input: TIn, ctx: Context<TBag>) => Promise<TOut>;
   ```

3. **`Context<TBag>`** — runtime object passed to workflow body. Owns the per-run bag and exposes node/sub-workflow invocation.
   ```ts
   interface Context<TBag extends Record<string, unknown>> {
     get<K extends keyof TBag>(key: K): TBag[K] | undefined;
     set<K extends keyof TBag>(key: K, value: TBag[K]): void;
     has<K extends keyof TBag>(key: K): boolean;

     run<I, O>(node: Type<Node<I, O>>, input: I): Promise<O>;
     runWorkflow<TIn, TOut, TSubBag extends Record<string, unknown>>(
       wf: WorkflowFn<TIn, TOut, TSubBag>,
       input: TIn,
     ): Promise<TOut>;
   }
   ```
   `getRequired<K>(key)` may be added if missing-key-throws ergonomics prove useful in practice. Not part of v1.

4. **`WorkflowEngine`** — `@Injectable()` Nest service. Single public entry point.
   ```ts
   @Injectable()
   class WorkflowEngine {
     constructor(private moduleRef: ModuleRef) {}
     run<TIn, TOut, TBag extends Record<string, unknown>>(
       wf: WorkflowFn<TIn, TOut, TBag>,
       input: TIn,
     ): Promise<{ result: TOut; trace: Trace }>;
   }
   ```

5. **Trace** — pure data emitted during a run. Nests for sub-workflows.
   ```ts
   type Trace = {
     workflowName: string;
     startedAt: number;
     finishedAt: number;
     status: 'ok' | 'error';
     input: unknown;
     output?: unknown;
     error?: { message: string; stack?: string };
     steps: TraceStep[];
   };

   type TraceStep =
     | {
         kind: 'node';
         name: string;
         input: unknown;
         output?: unknown;
         startedAt: number;
         finishedAt: number;
         status: 'ok' | 'error';
         error?: { message: string; stack?: string };
       }
     | {
         kind: 'subworkflow';
         name: string;
         input: unknown;
         output?: unknown;
         startedAt: number;
         finishedAt: number;
         status: 'ok' | 'error';
         error?: { message: string; stack?: string };
         trace: Trace;
       };
   ```

### Error type

```ts
class WorkflowError extends Error {
  constructor(public readonly cause: unknown, public readonly trace: Trace) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}
```

`engine.run` throws `WorkflowError` (with `trace` attached) when the workflow body throws past its own `try/catch`. Callers handle with normal TS:
```ts
try {
  const { result, trace } = await engine.run(checkoutWf, input);
} catch (e) {
  if (e instanceof WorkflowError) { /* inspect e.trace */ }
}
```

### File layout

```
src/
  engine/
    node.ts            # abstract Node<I, O>
    context.ts         # Context<TBag> interface + impl
    workflow.ts        # WorkflowFn<TIn, TOut, TBag> type
    trace.ts           # Trace, TraceStep types
    errors.ts          # WorkflowError
    engine.ts          # WorkflowEngine service
    engine.module.ts   # @Module exporting WorkflowEngine
    index.ts           # public surface re-exports
  app.module.ts        # imports EngineModule
```

User-defined nodes and workflows live outside `src/engine/` (e.g. `src/nodes/`, `src/workflows/`). Nothing in `src/engine/` should import from those directories.

## Data flow

### `engine.run(wf, input)` lifecycle

1. Engine creates a fresh `Trace`: `workflowName = wf.name`, `startedAt = Date.now()`, empty `steps[]`.
2. Engine creates a fresh `Context`: empty bag, holding a reference to `ModuleRef` and the current `Trace`.
3. Engine wraps the workflow call:
   ```ts
   try {
     const result = await wf(input, ctx);
     trace.status = 'ok';
     trace.output = result;
     return { result, trace };
   } catch (cause) {
     trace.status = 'error';
     trace.error = serializeError(cause);
     throw new WorkflowError(cause, trace);
   } finally {
     trace.finishedAt = Date.now();
   }
   ```

### `ctx.run(NodeClass, input)` lifecycle

1. Resolve node instance: `moduleRef.get(NodeClass, { strict: false })`. (Engine module imports must make node providers reachable.)
2. Append a pending `TraceStep` (`kind: 'node'`, `startedAt = now`).
3. Call `node.execute(input)` inside `try/catch`.
   - On success: set `output`, `status = 'ok'`, `finishedAt`. Return result.
   - On error: set `status = 'error'`, serialized `error`, `finishedAt`. Re-throw original `cause` so the workflow body's `try/catch` (or the top-level engine catch) sees it.

### `ctx.runWorkflow(subWf, subInput)` lifecycle

1. Create a child `Context` with a fresh bag and a fresh `Trace` (independent of parent's).
2. Run the same lifecycle as `engine.run` against the child context.
3. Append a `TraceStep` of `kind: 'subworkflow'` to the parent trace, embedding the child trace.
4. Return the child workflow's result to the parent.

If a sub-workflow throws, the engine still records it as a subworkflow step on the parent trace, then re-throws the original cause so the parent can `try/catch` or bubble.

### Bag and trace lifetimes

- Bag: created empty when context is created. Lives until the workflow returns or throws. Discarded after `engine.run` returns. Not shared across runs. Parent and child sub-workflows have independent bags.
- Trace: built in memory during the run. Returned to caller. Engine does not persist anywhere.

## Type-safety contract

The engine guarantees, at compile time:

- Node input and output types: `ctx.run(NodeClass, input)` requires `input: I` and returns `Promise<O>` matching `Node<I, O>`.
- Bag keys: `ctx.set` and `ctx.get` are constrained to `keyof TBag`. Unknown keys are TS errors.
- Bag values: `ctx.set(key, value)` requires `value` to match `TBag[key]`.
- Sub-workflow input/output: typed by the imported `WorkflowFn` reference.

No `any`, no string-typed casts, no runtime type checks required in user code.

## Error handling

- Plain TS `try/catch` in workflow code is the only mechanism.
- Engine never silently swallows errors. Every node and sub-workflow failure lands in the trace.
- Engine never retries. No timeouts. No circuit breakers. Authors who need retries write them in workflow code (or in a wrapping node) for v1.
- `WorkflowError.trace` is the contract for post-mortem inspection.

## Testing strategy

- **Node unit tests** — instantiate directly with mock deps; call `.execute(input)`. No engine, no Nest module needed for pure-logic nodes.
- **Workflow tests** — default: real `WorkflowEngine` inside a Nest test module with required node providers (override Nest deps with mocks). Fallback: pass a hand-rolled `Context` stub for branch-coverage scenarios.
- **Engine internal tests** — trace ordering, sub-workflow nesting, error propagation (`WorkflowError` shape + attached trace), `ModuleRef` resolution.
- **E2E** — out of scope for v1. Will land when an adapter (HTTP, CLI) is built.

Test layout:
```
src/engine/*.spec.ts        # engine internals
src/nodes/*.spec.ts         # node units
src/workflows/*.spec.ts     # workflow tests
```

## Explicitly out of scope (v1)

- HTTP, CLI, cron, or any other trigger adapter.
- Persistence of traces or workflow state.
- Retry, timeout, or circuit-breaker policies.
- Streaming / partial outputs (e.g. token-by-token LLM output).
- Visual editor or live execution UI (a future read-only UI consumes traces).
- Workflow versioning, migrations, scheduled execution.
- Dynamic workflow construction from JSON / data (would require a DSL).

## Open questions deferred to implementation

- Whether `Context.getRequired` (throws on missing key) should ship in v1. Decide once we see real workflows.
- Whether `engine.run` should also support being given a node class directly (`engine.run(SomeNode, input)`) as a one-off convenience. Probably no, to keep the surface tight.
- Logging integration — engine emits trace data only as return value for v1. A Nest logger hook can be added later without breaking the public API.
