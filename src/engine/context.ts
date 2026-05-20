import type { Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';
import { serializeError, type Trace, type TraceStep } from './trace';

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

export class ContextImpl<
  TBag extends Record<string, unknown>,
> implements Context<TBag> {
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
}
