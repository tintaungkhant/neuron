import type { Context } from './context';

export type WorkflowFn<TIn = unknown, TOut = unknown> = (
  input: TIn,
  wf: Context,
) => Promise<TOut>;
