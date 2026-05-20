import type { Type } from '@nestjs/common';
import type { Node } from './node';
import type { WorkflowFn } from './workflow';

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
