import { ModuleRef } from '@nestjs/core';
import { ContextImpl } from './context';
import type { Trace } from './trace';
import { Node } from './node';
import type { WorkflowFn } from './workflow';

function makeTrace(): Trace {
  return {
    workflowName: 'test',
    startedAt: 0,
    finishedAt: 0,
    status: 'ok',
    input: undefined,
    steps: [],
  };
}

class DoubleNode extends Node<{ x: number }, number> {
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute(input: { x: number }) {
    return input.x * 2;
  }
}

class BoomNode extends Node<void, void> {
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute() {
    throw new Error('boom');
  }
}

function makeCtxWithRef(moduleRef: Partial<ModuleRef>) {
  const trace = makeTrace();
  const wf = new ContextImpl(trace, moduleRef as ModuleRef);
  return { wf, trace };
}

describe('ContextImpl.run', () => {
  it('resolves the node via ModuleRef and returns its output', async () => {
    const instance = new DoubleNode();
    const get = jest.fn().mockReturnValue(instance);
    const { wf, trace } = makeCtxWithRef({ get });

    const out = await wf.run(DoubleNode, { x: 3 });

    expect(out).toBe(6);
    expect(get).toHaveBeenCalledWith(DoubleNode, { strict: false });
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'DoubleNode',
      input: { x: 3 },
      output: 6,
      status: 'ok',
    });
  });

  it('records error step and re-throws original cause when node fails', async () => {
    const get = jest.fn().mockReturnValue(new BoomNode());
    const { wf, trace } = makeCtxWithRef({ get });

    await expect(wf.run(BoomNode, undefined)).rejects.toThrow('boom');

    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'BoomNode',
      status: 'error',
      error: { message: 'boom' },
    });
  });

  it('sets startedAt and finishedAt timestamps on the step', async () => {
    const get = jest.fn().mockReturnValue(new DoubleNode());
    const { wf, trace } = makeCtxWithRef({ get });

    const before = Date.now();
    await wf.run(DoubleNode, { x: 1 });
    const after = Date.now();

    const step = trace.steps[0];
    expect(step.startedAt).toBeGreaterThanOrEqual(before);
    expect(step.finishedAt).toBeGreaterThanOrEqual(step.startedAt);
    expect(step.finishedAt).toBeLessThanOrEqual(after);
  });
});

describe('ContextImpl.runWorkflow', () => {
  it('runs a sub-workflow and nests its trace', async () => {
    const get = jest.fn().mockReturnValue(new DoubleNode());
    const { wf, trace } = makeCtxWithRef({ get });

    const sub: WorkflowFn<{ x: number }, number> = async (input, subWf) => {
      return subWf.run(DoubleNode, { x: input.x });
    };

    const out = await wf.runWorkflow(sub, { x: 5 });

    expect(out).toBe(10);
    expect(trace.steps).toHaveLength(1);
    const step = trace.steps[0];
    expect(step.kind).toBe('subworkflow');
    if (step.kind !== 'subworkflow') throw new Error('unreachable');
    expect(step.name).toBe('sub');
    expect(step.input).toEqual({ x: 5 });
    expect(step.output).toBe(10);
    expect(step.status).toBe('ok');
    expect(step.trace.status).toBe('ok');
    expect(step.trace.steps).toHaveLength(1);
    expect(step.trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'DoubleNode',
    });
  });

  it('records error and re-throws when sub-workflow fails', async () => {
    const { wf, trace } = makeCtxWithRef({ get: jest.fn() });

    // eslint-disable-next-line @typescript-eslint/require-await
    const failing: WorkflowFn<void, void> = async () => {
      throw new Error('child boom');
    };

    await expect(wf.runWorkflow(failing, undefined)).rejects.toThrow(
      'child boom',
    );

    const step = trace.steps[0];
    expect(step.kind).toBe('subworkflow');
    if (step.kind !== 'subworkflow') throw new Error('unreachable');
    expect(step.status).toBe('error');
    expect(step.error?.message).toBe('child boom');
    expect(step.trace.status).toBe('error');
    expect(step.trace.error?.message).toBe('child boom');
  });
});
