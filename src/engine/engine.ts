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
