import type { Context } from './context';

export type WorkflowFn<
  TIn = unknown,
  TOut = unknown,
  TBag extends Record<string, unknown> = Record<string, unknown>,
> = (input: TIn, ctx: Context<TBag>) => Promise<TOut>;
