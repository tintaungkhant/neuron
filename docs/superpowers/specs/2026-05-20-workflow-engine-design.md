# Workflow Engine — Design Spec

**Date:** 2026-05-20 (updated post-implementation: dropped context bag)
**Status:** v1 shipped on `main`
**Scope:** Core engine v1. No HTTP/CLI/cron adapters, no persistence, no UI.

## Goal

A code-defined workflow engine, conceptually "n8n developer edition". Developers compose workflows from reusable single-responsibility nodes in plain TypeScript. Type safety is the top priority. No database. No DSL. No visual editor in scope (read-only UI may consume traces later).

## Decisions at a glance

| Concern | Choice |
|---|---|
| Control flow | Imperative — workflow is a plain async TS function |
| State | Local TS variables in the workflow body; nodes are pure (input → output). No shared bag. |
| Sub-workflow | Independent invocation, explicit input + return value, trace nests |
| Trigger | Programmatic only; HTTP/CLI/cron adapters out of scope for v1 |
| Error handling | Plain TS `try/catch`; engine records all failures to trace |
| Nodes | `@Injectable()` Nest providers, resolved via `ModuleRef` |
| Workflows | Plain async functions (not Nest providers) |
| Engine return | `{ result, trace }` on success; throws `WorkflowError` (with trace attached) on failure |
| Trace | In-memory only; engine returns it, caller persists if wanted |

### State management

The engine deliberately does NOT carry a context bag. Cross-step state lives in the workflow function's local scope as plain TypeScript variables. Nodes receive only their typed `input` and return a typed `output` — they cannot read shared state. Rationale:

- Local variables give a single, top-to-bottom-readable source of truth.
- Pure-input/pure-output nodes are trivially testable in isolation.
- Object references in JS are zero-copy: parsing once and passing the same array into multiple nodes does not duplicate memory.
- The "shared mutable bag" pattern caused state-tracking bugs in past projects. Excluding it forces explicit state machine design in the workflow body.

Idiomatic mutation pattern:

```ts
let state = { messages, findings: [] };

const f1 = await ctx.run(LlmA, { messages: state.messages });
state = { ...state, findings: [...state.findings, f1] };

const out2 = await ctx.run(LlmB, {
  messages: state.messages,
  priorFindings: state.findings,
});
state = { ...state, findings: [...state.findings, out2] };
```

Each `state = ...` reassignment is explicit and greppable; the trace records every node's input as a snapshot of state at that step.

## Architecture

Five pieces:

1. **`Node<I, O>`** — abstract class. Subclasses are `@Injectable()` Nest providers. Stateless. Single responsibility. Contract:
   ```ts
   abstract execute(input: I): Promise<O>;
   ```
   Nodes do not see the workflow context. Their deps come from their constructor (Nest DI). If a node needs to coordinate multiple operations, it is actually a workflow.

2. **Workflow** — plain async function. Not a Nest provider. Imported and passed by reference.
   ```ts
   type WorkflowFn<TIn = unknown, TOut = unknown> =
     (input: TIn, ctx: Context) => Promise<TOut>;
   ```

3. **`Context`** — runtime object passed to workflow body. Exposes node and sub-workflow invocation. No bag.
   ```ts
   interface Context {
     run<I, O>(node: Type<Node<I, O>>, input: I): Promise<O>;
     runWorkflow<TIn, TOut>(
       wf: WorkflowFn<TIn, TOut>,
       input: TIn,
     ): Promise<TOut>;
   }
   ```

4. **`WorkflowEngine`** — `@Injectable()` Nest service. Single public entry point.
   ```ts
   @Injectable()
   class WorkflowEngine {
     constructor(private moduleRef: ModuleRef) {}
     run<TIn, TOut>(
       wf: WorkflowFn<TIn, TOut>,
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
    context.ts         # Context interface + ContextImpl
    workflow.ts        # WorkflowFn<TIn, TOut> type
    trace.ts           # Trace, TraceStep types, serializeError
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
2. Engine creates a fresh `Context` holding references to `ModuleRef` and the current `Trace`.
3. Engine wraps the workflow call:
   ```ts
   try {
     const result = await wf(input, ctx);
     trace.status = 'ok';
     trace.output = result;
     trace.finishedAt = Date.now();
     return { result, trace };
   } catch (cause) {
     trace.status = 'error';
     trace.error = serializeError(cause);
     trace.finishedAt = Date.now();
     throw new WorkflowError(cause, trace);
   }
   ```

### `ctx.run(NodeClass, input)` lifecycle

1. Resolve node instance: `moduleRef.get(NodeClass, { strict: false })`. (Engine module imports must make node providers reachable.)
2. Append a pending `TraceStep` (`kind: 'node'`, `startedAt = now`).
3. Call `node.execute(input)` inside `try/catch`.
   - On success: set `output`, `status = 'ok'`, `finishedAt`. Return result.
   - On error: set `status = 'error'`, serialized `error`, `finishedAt`. Re-throw original `cause` so the workflow body's `try/catch` (or the top-level engine catch) sees it.

### `ctx.runWorkflow(subWf, subInput)` lifecycle

1. Create a child `Context` with a fresh `Trace` (independent of parent's).
2. Run the same lifecycle as `engine.run` against the child context.
3. Append a `TraceStep` of `kind: 'subworkflow'` to the parent trace, embedding the child trace.
4. Return the child workflow's result to the parent.

If a sub-workflow throws, the engine still records it as a subworkflow step on the parent trace, then re-throws the original cause so the parent can `try/catch` or bubble.

### Trace lifetime

Built in memory during the run. Returned to caller. Engine does not persist anywhere. Caller writes to file/logger/HTTP response if needed.

## Type-safety contract

The engine guarantees, at compile time:

- **Node input and output types**: `ctx.run(NodeClass, input)` requires `input: I` and returns `Promise<O>` matching `Node<I, O>`.
- **Sub-workflow input and output types**: typed by the imported `WorkflowFn` reference.
- **Local state**: a plain TypeScript variable. Author's `let state: MyState = ...` declaration carries the full type. No bag means no compile-time string-key lookups to enforce.

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
- Shared context bag / scoped key-value state. Investigated during v1 implementation, removed before declaring v1.1 done — see "State management" above. If a future use case (e.g. ambient request-scoped data needed by many deep nodes) makes the alternative untenable, re-evaluate; otherwise stay with local-state pattern.

## Change log

- **v1.0** (initial): shipped with `Context<TBag>` carrying a typed bag (`get`/`set`/`has`).
- **v1.1** (commit `1e363ef`): bag removed. `Context`, `ContextImpl`, `WorkflowFn`, `WorkflowEngine.run` lost their `TBag` generic. Workflows manage state via local TS variables instead.

## Open questions deferred to implementation

- Whether `engine.run` should also support being given a node class directly (`engine.run(SomeNode, input)`) as a one-off convenience. Probably no, to keep the surface tight.
- Logging integration — engine emits trace data only as return value for v1. A Nest logger hook can be added later without breaking the public API.
- If real workflows produce traces large enough to cause memory pressure, add streaming/sink semantics. Out of scope until measured.
