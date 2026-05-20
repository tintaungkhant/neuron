import type { Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';
import type { Trace } from './trace';

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

  // run() and runWorkflow() are stubbed here so the class satisfies
  // Context<TBag>. Real implementations land in Tasks 4 and 5.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run<I, O>(_node: Type<Node<I, O>>, _input: I): Promise<O> {
    void this.trace;
    void this.moduleRef;
    return await Promise.reject(new Error('not implemented'));
  }

  async runWorkflow<TIn, TOut, TSubBag extends Record<string, unknown>>(
    _wf: WorkflowFn<TIn, TOut, TSubBag>,
    _input: TIn,
  ): Promise<TOut> {
    void _wf;
    void _input;
    return await Promise.reject(new Error('not implemented'));
  }
}
