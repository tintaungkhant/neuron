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
