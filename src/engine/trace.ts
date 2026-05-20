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
