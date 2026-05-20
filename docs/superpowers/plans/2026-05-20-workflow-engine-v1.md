# Workflow Engine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workflow engine kernel described in `docs/superpowers/specs/2026-05-20-workflow-engine-design.md`: an imperative TS workflow runtime with typed context bags, Nest-DI-resolved nodes, in-memory traces, and programmatic-only triggering.

**Architecture:** A single `EngineModule` exporting a `WorkflowEngine` service. Engine holds a `ModuleRef`, resolves `@Injectable()` `Node` providers, and runs plain-async-function workflows. Each run gets a fresh `Context<TBag>` carrying a typed bag, a trace, and the `ModuleRef`. Sub-workflows are recursive `ContextImpl` runs whose trace embeds in the parent step list. Workflow failures throw `WorkflowError` with the trace attached.

**Tech Stack:** TypeScript 5.7, NestJS 11, pnpm, Jest 30 (ts-jest), ESLint 9.

---

## File Structure

Files this plan creates:

```
src/engine/
  node.ts            # abstract Node<I, O> (pure type/class skeleton)
  workflow.ts        # WorkflowFn<TIn, TOut, TBag> type alias
  trace.ts           # Trace + TraceStep types + serializeError helper
  errors.ts          # WorkflowError
  context.ts         # Context<TBag> interface + ContextImpl class
  engine.ts          # WorkflowEngine @Injectable service
  engine.module.ts   # @Module exporting WorkflowEngine
  index.ts           # public surface re-exports
  trace.spec.ts      # serializeError tests
  errors.spec.ts     # WorkflowError tests
  context.spec.ts    # ContextImpl bag + run + runWorkflow tests
  engine.spec.ts     # WorkflowEngine integration tests via Nest test module
```

Files this plan modifies:

```
src/app.module.ts    # import EngineModule
```

User-defined nodes and workflows are NOT created by this plan. They will live outside `src/engine/` in later work (e.g. `src/nodes/`, `src/workflows/`). Engine files must not import from those directories.

---

## Task 1: Type-only skeleton files

Establish the type surface first so subsequent tasks can import what they need. No runtime behavior here — only `abstract class Node` (a class skeleton with no body) and type aliases. Verified via `tsc --noEmit` and `eslint`.

**Files:**
- Create: `src/engine/node.ts`
- Create: `src/engine/workflow.ts`
- Create: `src/engine/trace.ts` (types only — `serializeError` is added in Task 2)
- Create: `src/engine/context.ts` (interface only — `ContextImpl` added in Task 3)

- [ ] **Step 1: Create `src/engine/node.ts`**

```ts
export abstract class Node<I = unknown, O = unknown> {
  abstract execute(input: I): Promise<O>;
}
```

- [ ] **Step 2: Create `src/engine/trace.ts`**

```ts
export type SerializedError = { message: string; stack?: string };

export type TraceStep =
  | {
      kind: 'node';
      name: string;
      input: unknown;
      output?: unknown;
      startedAt: number;
      finishedAt: number;
      status: 'ok' | 'error';
      error?: SerializedError;
    }
  | {
      kind: 'subworkflow';
      name: string;
      input: unknown;
      output?: unknown;
      startedAt: number;
      finishedAt: number;
      status: 'ok' | 'error';
      error?: SerializedError;
      trace: Trace;
    };

export type Trace = {
  workflowName: string;
  startedAt: number;
  finishedAt: number;
  status: 'ok' | 'error';
  input: unknown;
  output?: unknown;
  error?: SerializedError;
  steps: TraceStep[];
};
```

- [ ] **Step 3: Create `src/engine/context.ts` (interface only)**

```ts
import type { Type } from '@nestjs/common';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';

export interface Context<TBag extends Record<string, unknown>> {
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

- [ ] **Step 4: Create `src/engine/workflow.ts`**

```ts
import type { Context } from './context';

export type WorkflowFn<
  TIn = unknown,
  TOut = unknown,
  TBag extends Record<string, unknown> = Record<string, unknown>,
> = (input: TIn, ctx: Context<TBag>) => Promise<TOut>;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no output (success).

- [ ] **Step 6: Verify lint passes**

Run: `pnpm lint`
Expected: no errors. (ESLint may auto-fix formatting; that is fine.)

- [ ] **Step 7: Commit**

```bash
git add src/engine/node.ts src/engine/workflow.ts src/engine/trace.ts src/engine/context.ts
git commit -m "feat(engine): add type skeletons (Node, WorkflowFn, Trace, Context)"
```

---

## Task 2: `serializeError` + `WorkflowError`

`serializeError` converts thrown values into the `SerializedError` shape stored on traces. `WorkflowError` is the exception type thrown by `engine.run` when a workflow fails. Both have tested behavior and ship together because `WorkflowError` uses `serializeError`-style message extraction.

**Files:**
- Modify: `src/engine/trace.ts` (add `serializeError` function below the existing types)
- Create: `src/engine/trace.spec.ts`
- Create: `src/engine/errors.ts`
- Create: `src/engine/errors.spec.ts`

- [ ] **Step 1: Write failing test for `serializeError`**

Create `src/engine/trace.spec.ts`:

```ts
import { serializeError } from './trace';

describe('serializeError', () => {
  it('captures message and stack from an Error', () => {
    const e = new Error('boom');
    const out = serializeError(e);
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
  });

  it('stringifies non-Error values', () => {
    expect(serializeError('nope')).toEqual({ message: 'nope' });
    expect(serializeError(42)).toEqual({ message: '42' });
    expect(serializeError({ foo: 1 })).toEqual({ message: '[object Object]' });
  });

  it('handles null and undefined', () => {
    expect(serializeError(null)).toEqual({ message: 'null' });
    expect(serializeError(undefined)).toEqual({ message: 'undefined' });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test -- trace.spec`
Expected: FAIL — `serializeError` is not exported from `./trace`.

- [ ] **Step 3: Implement `serializeError`**

Append to `src/engine/trace.ts`:

```ts
export function serializeError(cause: unknown): SerializedError {
  if (cause instanceof Error) {
    return { message: cause.message, stack: cause.stack };
  }
  return { message: String(cause) };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm test -- trace.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Write failing test for `WorkflowError`**

Create `src/engine/errors.spec.ts`:

```ts
import { WorkflowError } from './errors';
import type { Trace } from './trace';

const emptyTrace: Trace = {
  workflowName: 'wf',
  startedAt: 0,
  finishedAt: 0,
  status: 'error',
  input: undefined,
  steps: [],
};

describe('WorkflowError', () => {
  it('extracts message from Error cause', () => {
    const cause = new Error('boom');
    const err = new WorkflowError(cause, emptyTrace);
    expect(err.message).toBe('boom');
    expect(err.cause).toBe(cause);
    expect(err.trace).toBe(emptyTrace);
  });

  it('stringifies non-Error causes', () => {
    const err = new WorkflowError('nope', emptyTrace);
    expect(err.message).toBe('nope');
    expect(err.cause).toBe('nope');
  });

  it('is an instance of Error', () => {
    const err = new WorkflowError(new Error('x'), emptyTrace);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkflowError);
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm test -- errors.spec`
Expected: FAIL — `WorkflowError` not found.

- [ ] **Step 7: Implement `WorkflowError`**

Create `src/engine/errors.ts`:

```ts
import type { Trace } from './trace';

export class WorkflowError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly trace: Trace,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'WorkflowError';
  }
}
```

- [ ] **Step 8: Run test, verify it passes**

Run: `pnpm test -- errors.spec`
Expected: PASS (3 tests).

- [ ] **Step 9: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/engine/trace.ts src/engine/trace.spec.ts src/engine/errors.ts src/engine/errors.spec.ts
git commit -m "feat(engine): add serializeError + WorkflowError"
```

---

## Task 3: `ContextImpl` — bag operations

Implement `ContextImpl` with only the bag operations (`get`, `set`, `has`). `run` and `runWorkflow` are added in Tasks 4 and 5. Bag is backed by an internal `Map`. The class is fully typed via the `Context<TBag>` interface.

**Files:**
- Modify: `src/engine/context.ts` (add `ContextImpl` class beneath the interface)
- Create: `src/engine/context.spec.ts`

- [ ] **Step 1: Write failing tests for bag operations**

Create `src/engine/context.spec.ts`:

```ts
import { ModuleRef } from '@nestjs/core';
import { ContextImpl } from './context';
import type { Trace } from './trace';

function makeTrace(): Trace {
  return {
    workflowName: 'test',
    startedAt: 0,
    finishedAt: 0,
    status: 'ok',
    input: undefined,
    steps: [],
  };
}

function makeCtx<TBag extends Record<string, unknown>>() {
  return new ContextImpl<TBag>(makeTrace(), {} as ModuleRef);
}

describe('ContextImpl — bag operations', () => {
  it('set and get round-trip a value', () => {
    type Bag = { user: { id: number } };
    const ctx = makeCtx<Bag>();
    ctx.set('user', { id: 1 });
    expect(ctx.get('user')).toEqual({ id: 1 });
  });

  it('get returns undefined for missing key', () => {
    type Bag = { user: string };
    const ctx = makeCtx<Bag>();
    expect(ctx.get('user')).toBeUndefined();
  });

  it('has reports key presence', () => {
    type Bag = { user: string };
    const ctx = makeCtx<Bag>();
    expect(ctx.has('user')).toBe(false);
    ctx.set('user', 'alice');
    expect(ctx.has('user')).toBe(true);
  });

  it('overwrites an existing value', () => {
    type Bag = { count: number };
    const ctx = makeCtx<Bag>();
    ctx.set('count', 1);
    ctx.set('count', 2);
    expect(ctx.get('count')).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- context.spec`
Expected: FAIL — `ContextImpl` not exported from `./context`.

- [ ] **Step 3: Implement `ContextImpl` (bag operations only)**

Update the import block at the top of `src/engine/context.ts` to add `ModuleRef` (value import) and `Trace` (type import). The final import block must be:

```ts
import type { Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';
import type { Trace } from './trace';
```

Then append the class beneath the existing `Context` interface:

```ts
export class ContextImpl<TBag extends Record<string, unknown>>
  implements Context<TBag>
{
  private readonly bag = new Map<keyof TBag, TBag[keyof TBag]>();

  constructor(
    private readonly trace: Trace,
    private readonly moduleRef: ModuleRef,
  ) {}

  get<K extends keyof TBag>(key: K): TBag[K] | undefined {
    return this.bag.get(key) as TBag[K] | undefined;
  }

  set<K extends keyof TBag>(key: K, value: TBag[K]): void {
    this.bag.set(key, value);
  }

  has<K extends keyof TBag>(key: K): boolean {
    return this.bag.has(key);
  }

  // run() and runWorkflow() are stubbed here so the class satisfies
  // Context<TBag>. Real implementations land in Tasks 4 and 5.
  async run<I, O>(_node: Type<Node<I, O>>, _input: I): Promise<O> {
    void this.trace;
    void this.moduleRef;
    throw new Error('not implemented');
  }

  async runWorkflow<TIn, TOut, TSubBag extends Record<string, unknown>>(
    _wf: WorkflowFn<TIn, TOut, TSubBag>,
    _input: TIn,
  ): Promise<TOut> {
    throw new Error('not implemented');
  }
}
```

Notes:
- Stub parameter names use the `_` prefix so `@typescript-eslint/no-unused-vars` (enabled by the recommended config) ignores them.
- `void this.trace` / `void this.moduleRef` keeps lint quiet while the private fields are not yet read by a real method. They are removed when Task 4 implements `run`.
- The stub signatures exactly match the `Context<TBag>` interface so the `implements` clause type-checks.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- context.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/context.ts src/engine/context.spec.ts
git commit -m "feat(engine): ContextImpl bag operations"
```

---

## Task 4: `ContextImpl.run` — node execution + trace recording

Implement `run`. It resolves the node via `ModuleRef.get(NodeClass, { strict: false })`, appends a `kind: 'node'` step to the trace, executes the node, and records output or error. On error it re-throws the original cause so the workflow body's `try/catch` (or the engine's top-level catch) sees it.

**Files:**
- Modify: `src/engine/context.ts` (replace the `run` stub with the real implementation; update imports)
- Modify: `src/engine/context.spec.ts` (add `describe('ContextImpl.run', ...)`)

- [ ] **Step 1: Add failing tests for `run`**

Append to `src/engine/context.spec.ts`:

```ts
import { Node } from './node';

class DoubleNode extends Node<{ x: number }, number> {
  async execute(input: { x: number }) {
    return input.x * 2;
  }
}

class BoomNode extends Node<void, void> {
  async execute() {
    throw new Error('boom');
  }
}

function makeCtxWithRef<TBag extends Record<string, unknown>>(
  moduleRef: Partial<ModuleRef>,
) {
  const trace = makeTrace();
  const ctx = new ContextImpl<TBag>(trace, moduleRef as ModuleRef);
  return { ctx, trace };
}

describe('ContextImpl.run', () => {
  it('resolves the node via ModuleRef and returns its output', async () => {
    const instance = new DoubleNode();
    const get = jest.fn().mockReturnValue(instance);
    const { ctx, trace } = makeCtxWithRef({ get });

    const out = await ctx.run(DoubleNode, { x: 3 });

    expect(out).toBe(6);
    expect(get).toHaveBeenCalledWith(DoubleNode, { strict: false });
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'DoubleNode',
      input: { x: 3 },
      output: 6,
      status: 'ok',
    });
  });

  it('records error step and re-throws original cause when node fails', async () => {
    const get = jest.fn().mockReturnValue(new BoomNode());
    const { ctx, trace } = makeCtxWithRef({ get });

    await expect(ctx.run(BoomNode, undefined)).rejects.toThrow('boom');

    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'BoomNode',
      status: 'error',
      error: { message: 'boom' },
    });
  });

  it('sets startedAt and finishedAt timestamps on the step', async () => {
    const get = jest.fn().mockReturnValue(new DoubleNode());
    const { ctx, trace } = makeCtxWithRef({ get });

    const before = Date.now();
    await ctx.run(DoubleNode, { x: 1 });
    const after = Date.now();

    const step = trace.steps[0];
    expect(step.startedAt).toBeGreaterThanOrEqual(before);
    expect(step.finishedAt).toBeGreaterThanOrEqual(step.startedAt);
    expect(step.finishedAt).toBeLessThanOrEqual(after);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- context.spec`
Expected: FAIL — the existing `run` stub throws `'not implemented'`.

- [ ] **Step 3: Implement `run`**

Update the import block at the top of `src/engine/context.ts` to add `serializeError` (value) and `TraceStep` (type). The final import block must be:

```ts
import type { Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';
import { serializeError, type Trace, type TraceStep } from './trace';
```

(`Type`, `Node`, and `WorkflowFn` stay as type-only imports — they are only used as type annotations.)

Replace the `run` stub body in `src/engine/context.ts` with:

```ts
  async run<I, O>(node: Type<Node<I, O>>, input: I): Promise<O> {
    const instance = this.moduleRef.get(node, { strict: false });
    const step: TraceStep = {
      kind: 'node',
      name: node.name,
      input,
      startedAt: Date.now(),
      finishedAt: 0,
      status: 'ok',
    };
    this.trace.steps.push(step);
    try {
      const output = await instance.execute(input);
      step.output = output;
      step.finishedAt = Date.now();
      return output;
    } catch (cause) {
      step.status = 'error';
      step.error = serializeError(cause);
      step.finishedAt = Date.now();
      throw cause;
    }
  }
```

Remove the `void this.trace;` / `void this.moduleRef;` placeholders from the stub — both fields are now read by the real implementation.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- context.spec`
Expected: PASS (7 tests total: 4 bag + 3 run).

- [ ] **Step 5: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/context.ts src/engine/context.spec.ts
git commit -m "feat(engine): ContextImpl.run resolves via ModuleRef and records trace"
```

---

## Task 5: `ContextImpl.runWorkflow` — sub-workflow with nested trace

Implement `runWorkflow`. Spawns a fresh child `ContextImpl` (new empty bag, new child `Trace`), runs the sub-workflow function, and appends a `kind: 'subworkflow'` step to the parent trace whose `trace` field is the child's trace. On error, records error on both parent step and child trace, then re-throws the original cause.

**Files:**
- Modify: `src/engine/context.ts` (replace the `runWorkflow` stub)
- Modify: `src/engine/context.spec.ts` (add `describe('ContextImpl.runWorkflow', ...)`)

- [ ] **Step 1: Add failing tests for `runWorkflow`**

Append to `src/engine/context.spec.ts`:

```ts
import type { WorkflowFn } from './workflow';

describe('ContextImpl.runWorkflow', () => {
  it('runs a sub-workflow with a fresh bag and nests its trace', async () => {
    const get = jest.fn().mockReturnValue(new DoubleNode());
    const { ctx, trace } = makeCtxWithRef({ get });

    const sub: WorkflowFn<{ x: number }, number, Record<string, never>> =
      async (input, subCtx) => {
        return subCtx.run(DoubleNode, { x: input.x });
      };

    const out = await ctx.runWorkflow(sub, { x: 5 });

    expect(out).toBe(10);
    expect(trace.steps).toHaveLength(1);
    const step = trace.steps[0];
    expect(step.kind).toBe('subworkflow');
    if (step.kind !== 'subworkflow') throw new Error('unreachable');
    expect(step.name).toBe('sub');
    expect(step.input).toEqual({ x: 5 });
    expect(step.output).toBe(10);
    expect(step.status).toBe('ok');
    expect(step.trace.status).toBe('ok');
    expect(step.trace.steps).toHaveLength(1);
    expect(step.trace.steps[0]).toMatchObject({ kind: 'node', name: 'DoubleNode' });
  });

  it('records error and re-throws when sub-workflow fails', async () => {
    const { ctx, trace } = makeCtxWithRef({ get: jest.fn() });

    const failing: WorkflowFn<void, void, Record<string, never>> = async () => {
      throw new Error('child boom');
    };

    await expect(ctx.runWorkflow(failing, undefined)).rejects.toThrow(
      'child boom',
    );

    const step = trace.steps[0];
    expect(step.kind).toBe('subworkflow');
    if (step.kind !== 'subworkflow') throw new Error('unreachable');
    expect(step.status).toBe('error');
    expect(step.error?.message).toBe('child boom');
    expect(step.trace.status).toBe('error');
    expect(step.trace.error?.message).toBe('child boom');
  });

  it('parent bag is independent of child bag', async () => {
    type ParentBag = { shared: string };
    const { ctx } = makeCtxWithRef<ParentBag>({ get: jest.fn() });
    ctx.set('shared', 'parent-value');

    const sub: WorkflowFn<void, string | undefined, ParentBag> = async (
      _input,
      subCtx,
    ) => subCtx.get('shared');

    const out = await ctx.runWorkflow(sub, undefined);
    expect(out).toBeUndefined();
    expect(ctx.get('shared')).toBe('parent-value');
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- context.spec`
Expected: FAIL — `runWorkflow` stub throws `'not implemented'`.

- [ ] **Step 3: Implement `runWorkflow`**

Replace the existing `runWorkflow` stub in `src/engine/context.ts` with:

```ts
  async runWorkflow<TIn, TOut, TSubBag extends Record<string, unknown>>(
    wf: WorkflowFn<TIn, TOut, TSubBag>,
    input: TIn,
  ): Promise<TOut> {
    const startedAt = Date.now();
    const childTrace: Trace = {
      workflowName: wf.name,
      startedAt,
      finishedAt: 0,
      status: 'ok',
      input,
      steps: [],
    };
    const childCtx = new ContextImpl<TSubBag>(childTrace, this.moduleRef);
    const step: TraceStep = {
      kind: 'subworkflow',
      name: wf.name,
      input,
      startedAt,
      finishedAt: 0,
      status: 'ok',
      trace: childTrace,
    };
    this.trace.steps.push(step);
    try {
      const output = await wf(input, childCtx);
      const finishedAt = Date.now();
      childTrace.output = output;
      childTrace.finishedAt = finishedAt;
      step.output = output;
      step.finishedAt = finishedAt;
      return output;
    } catch (cause) {
      const finishedAt = Date.now();
      const err = serializeError(cause);
      childTrace.status = 'error';
      childTrace.error = err;
      childTrace.finishedAt = finishedAt;
      step.status = 'error';
      step.error = err;
      step.finishedAt = finishedAt;
      throw cause;
    }
  }
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- context.spec`
Expected: PASS (10 tests total: 4 bag + 3 run + 3 runWorkflow).

- [ ] **Step 5: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/engine/context.ts src/engine/context.spec.ts
git commit -m "feat(engine): ContextImpl.runWorkflow nests child trace"
```

---

## Task 6: `WorkflowEngine` service — happy path

Implement `WorkflowEngine` as an `@Injectable()` Nest provider. Its `run` method builds a fresh top-level `Trace` and `ContextImpl`, invokes the workflow function, and returns `{ result, trace }`. Error handling (Task 7) is added next. This task also creates `EngineModule` so the integration test can boot via `Test.createTestingModule`.

**Files:**
- Create: `src/engine/engine.ts`
- Create: `src/engine/engine.module.ts`
- Create: `src/engine/engine.spec.ts`

- [ ] **Step 1: Write failing integration test for happy path**

Create `src/engine/engine.spec.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Node } from './node';
import { WorkflowEngine } from './engine';
import { EngineModule } from './engine.module';
import type { WorkflowFn } from './workflow';

@Injectable()
class GreetNode extends Node<{ name: string }, string> {
  async execute(input: { name: string }) {
    return `hi ${input.name}`;
  }
}

@Injectable()
class ShoutNode extends Node<{ text: string }, string> {
  async execute(input: { text: string }) {
    return input.text.toUpperCase();
  }
}

describe('WorkflowEngine — happy path', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [GreetNode, ShoutNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
  });

  afterEach(async () => {
    await mod.close();
  });

  it('runs a workflow, returns result + trace, records each node step', async () => {
    type Bag = { greeting: string };
    const wf: WorkflowFn<{ name: string }, string, Bag> = async function greetWf(
      input,
      ctx,
    ) {
      const g = await ctx.run(GreetNode, { name: input.name });
      ctx.set('greeting', g);
      const shouted = await ctx.run(ShoutNode, { text: g });
      return shouted;
    };

    const { result, trace } = await engine.run(wf, { name: 'alice' });

    expect(result).toBe('HI ALICE');
    expect(trace.workflowName).toBe('greetWf');
    expect(trace.status).toBe('ok');
    expect(trace.input).toEqual({ name: 'alice' });
    expect(trace.output).toBe('HI ALICE');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'GreetNode',
      status: 'ok',
    });
    expect(trace.steps[1]).toMatchObject({
      kind: 'node',
      name: 'ShoutNode',
      status: 'ok',
    });
    expect(trace.finishedAt).toBeGreaterThanOrEqual(trace.startedAt);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test -- engine.spec`
Expected: FAIL — `./engine` and `./engine.module` do not exist.

- [ ] **Step 3: Implement `WorkflowEngine`**

Create `src/engine/engine.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ContextImpl } from './context';
import { WorkflowError } from './errors';
import { serializeError, type Trace } from './trace';
import type { WorkflowFn } from './workflow';

@Injectable()
export class WorkflowEngine {
  constructor(private readonly moduleRef: ModuleRef) {}

  async run<TIn, TOut, TBag extends Record<string, unknown>>(
    wf: WorkflowFn<TIn, TOut, TBag>,
    input: TIn,
  ): Promise<{ result: TOut; trace: Trace }> {
    const trace: Trace = {
      workflowName: wf.name,
      startedAt: Date.now(),
      finishedAt: 0,
      status: 'ok',
      input,
      steps: [],
    };
    const ctx = new ContextImpl<TBag>(trace, this.moduleRef);
    try {
      const result = await wf(input, ctx);
      trace.output = result;
      trace.finishedAt = Date.now();
      return { result, trace };
    } catch (cause) {
      trace.status = 'error';
      trace.error = serializeError(cause);
      trace.finishedAt = Date.now();
      throw new WorkflowError(cause, trace);
    }
  }
}
```

The `WorkflowError` branch is exercised by Task 7. Including it now keeps the implementation in one place and avoids a transient state where the engine swallows errors.

- [ ] **Step 4: Implement `EngineModule`**

Create `src/engine/engine.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';

@Module({
  providers: [WorkflowEngine],
  exports: [WorkflowEngine],
})
export class EngineModule {}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm test -- engine.spec`
Expected: PASS (1 test).

- [ ] **Step 6: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/engine/engine.ts src/engine/engine.module.ts src/engine/engine.spec.ts
git commit -m "feat(engine): WorkflowEngine.run happy path + EngineModule"
```

---

## Task 7: `WorkflowEngine` error path — `WorkflowError` with attached trace

Cover the error branch of `engine.run`: when the workflow body throws past its own `try/catch`, the engine wraps the cause in `WorkflowError`, finalizes the trace (`status: 'error'`, `error` populated, `finishedAt` set), and throws. The implementation is already in place from Task 6; this task adds tests to lock in the behavior.

**Files:**
- Modify: `src/engine/engine.spec.ts` (add `describe('WorkflowEngine — error path', ...)`)

- [ ] **Step 1: Add failing tests for error path**

Append to `src/engine/engine.spec.ts`:

```ts
import { WorkflowError } from './errors';

describe('WorkflowEngine — error path', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [GreetNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
  });

  afterEach(async () => {
    await mod.close();
  });

  it('throws WorkflowError with trace when workflow throws', async () => {
    const wf: WorkflowFn<void, void> = async function failingWf() {
      throw new Error('nope');
    };

    await expect(engine.run(wf, undefined)).rejects.toBeInstanceOf(
      WorkflowError,
    );

    try {
      await engine.run(wf, undefined);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      const we = e as WorkflowError;
      expect(we.message).toBe('nope');
      expect(we.trace.workflowName).toBe('failingWf');
      expect(we.trace.status).toBe('error');
      expect(we.trace.error?.message).toBe('nope');
      expect(we.trace.finishedAt).toBeGreaterThanOrEqual(we.trace.startedAt);
    }
  });

  it('records the failing node step in the trace when a node throws', async () => {
    @Injectable()
    class FailingNode extends Node<void, void> {
      async execute() {
        throw new Error('node-failure');
      }
    }

    const localMod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [FailingNode],
    }).compile();
    const localEngine = localMod.get(WorkflowEngine);

    const wf: WorkflowFn<void, void> = async function uncaughtWf(_input, ctx) {
      await ctx.run(FailingNode, undefined);
    };

    try {
      await localEngine.run(wf, undefined);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      const we = e as WorkflowError;
      expect(we.trace.steps).toHaveLength(1);
      expect(we.trace.steps[0]).toMatchObject({
        kind: 'node',
        name: 'FailingNode',
        status: 'error',
        error: { message: 'node-failure' },
      });
    } finally {
      await localMod.close();
    }
  });

  it('continues execution when workflow catches the node error', async () => {
    @Injectable()
    class BoomNode extends Node<void, void> {
      async execute() {
        throw new Error('boom');
      }
    }

    const localMod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [BoomNode, GreetNode],
    }).compile();
    const localEngine = localMod.get(WorkflowEngine);

    const wf: WorkflowFn<void, string> = async function recoverWf(_input, ctx) {
      try {
        await ctx.run(BoomNode, undefined);
      } catch {
        // swallow
      }
      return ctx.run(GreetNode, { name: 'bob' });
    };

    const { result, trace } = await localEngine.run(wf, undefined);
    expect(result).toBe('hi bob');
    expect(trace.status).toBe('ok');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({ name: 'BoomNode', status: 'error' });
    expect(trace.steps[1]).toMatchObject({ name: 'GreetNode', status: 'ok' });
    await localMod.close();
  });
});
```

- [ ] **Step 2: Run tests, verify they pass**

Run: `pnpm test -- engine.spec`
Expected: PASS (4 tests total: 1 happy + 3 error).

The engine error branch is already implemented (Task 6), so these tests should pass on first run. If any fail, fix the engine code before continuing.

- [ ] **Step 3: Verify lint + full test run**

Run: `pnpm lint && pnpm test`
Expected: no lint errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/engine/engine.spec.ts
git commit -m "test(engine): WorkflowError + node-failure recovery scenarios"
```

---

## Task 8: Public surface + wire-up into `AppModule`

Expose the engine's public API via `src/engine/index.ts` so consumers import from a single entry point. Wire `EngineModule` into the root `AppModule`. No new tests — the existing engine tests already prove the public types are usable from outside `src/engine/` via the same imports.

**Files:**
- Create: `src/engine/index.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `src/engine/index.ts`**

```ts
export { Node } from './node';
export { WorkflowEngine } from './engine';
export { EngineModule } from './engine.module';
export { WorkflowError } from './errors';
export type { WorkflowFn } from './workflow';
export type { Context } from './context';
export type { Trace, TraceStep, SerializedError } from './trace';
```

- [ ] **Step 2: Read current `src/app.module.ts`**

Run: `cat src/app.module.ts`
Expected current content:

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Modify `src/app.module.ts` to import `EngineModule`**

Replace its contents with:

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EngineModule } from './engine';

@Module({
  imports: [EngineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Verify build succeeds**

Run: `pnpm build`
Expected: builds without errors. `dist/engine/index.js` exists.

- [ ] **Step 6: Verify full test suite passes**

Run: `pnpm test`
Expected: all engine tests pass (trace.spec + errors.spec + context.spec + engine.spec) plus the pre-existing `app.controller.spec.ts`.

- [ ] **Step 7: Verify lint passes**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/engine/index.ts src/app.module.ts
git commit -m "feat(engine): public surface + wire EngineModule into AppModule"
```

---

## Done criteria

After Task 8 completes:

- `src/engine/` contains the kernel described in the spec: `Node`, `WorkflowFn`, `Context`/`ContextImpl`, `WorkflowEngine`, `EngineModule`, `WorkflowError`, `Trace`/`TraceStep`, and `serializeError`.
- `pnpm test` runs all engine tests green.
- `pnpm lint` and `pnpm build` succeed.
- `EngineModule` is imported into `AppModule` so any consumer can `constructor(private engine: WorkflowEngine)`.
- No HTTP, CLI, or cron adapter exists. No persistence. No retry/timeout/circuit-breaker policies. These are explicitly out of scope (see spec).

Follow-up work (separate plans):
- HTTP adapter that maps `POST /workflows/<name>` → `engine.run(...)`.
- A first real domain workflow + nodes under `src/workflows/` + `src/nodes/`.
- Optional `getRequired` on `Context` if real workflows show the need.
