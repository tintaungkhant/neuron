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
