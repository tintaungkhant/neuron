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
