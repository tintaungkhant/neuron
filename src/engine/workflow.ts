import type { Context } from './context';

export type WorkflowFn<TIn = unknown, TOut = unknown> = (
  input: TIn,
  ctx: Context,
) => Promise<TOut>;
