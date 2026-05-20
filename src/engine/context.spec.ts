import { ModuleRef } from '@nestjs/core';
import { ContextImpl } from './context';
import type { Trace } from './trace';
import { Node } from './node';

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

class DoubleNode extends Node<{ x: number }, number> {
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(input: { x: number }) {
    return input.x * 2;
  }
}

class BoomNode extends Node<void, void> {
  // eslint-disable-next-line @typescript-eslint/require-await
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
