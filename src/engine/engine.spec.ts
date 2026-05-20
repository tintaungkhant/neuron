import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Node } from './node';
import { WorkflowEngine } from './engine';
import { EngineModule } from './engine.module';
import { WorkflowError } from './errors';
import type { WorkflowFn } from './workflow';

@Injectable()
class GreetNode extends Node<{ name: string }, string> {
  async execute(input: { name: string }) {
    return await Promise.resolve(`hi ${input.name}`);
  }
}

@Injectable()
class ShoutNode extends Node<{ text: string }, string> {
  async execute(input: { text: string }) {
    return await Promise.resolve(input.text.toUpperCase());
  }
}

describe('WorkflowEngine — happy path', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [GreetNode, ShoutNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
  });

  afterEach(async () => {
    await mod.close();
  });

  it('runs a workflow, returns result + trace, records each node step', async () => {
    const wf: WorkflowFn<{ name: string }, string> = async function greetWf(
      input,
      ctx,
    ) {
      const g = await ctx.run(GreetNode, { name: input.name });
      const shouted = await ctx.run(ShoutNode, { text: g });
      return shouted;
    };

    const { result, trace } = await engine.run(wf, { name: 'alice' });

    expect(result).toBe('HI ALICE');
    expect(trace.workflowName).toBe('greetWf');
    expect(trace.status).toBe('ok');
    expect(trace.input).toEqual({ name: 'alice' });
    expect(trace.output).toBe('HI ALICE');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'GreetNode',
      status: 'ok',
    });
    expect(trace.steps[1]).toMatchObject({
      kind: 'node',
      name: 'ShoutNode',
      status: 'ok',
    });
    expect(trace.finishedAt).toBeGreaterThanOrEqual(trace.startedAt);
  });
});

describe('WorkflowEngine — error path', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [GreetNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
  });

  afterEach(async () => {
    await mod.close();
  });

  it('throws WorkflowError with trace when workflow throws', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    const wf: WorkflowFn<void, void> = async function failingWf() {
      throw new Error('nope');
    };

    await expect(engine.run(wf, undefined)).rejects.toBeInstanceOf(
      WorkflowError,
    );

    try {
      await engine.run(wf, undefined);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      const we = e as WorkflowError;
      expect(we.message).toBe('nope');
      expect(we.trace.workflowName).toBe('failingWf');
      expect(we.trace.status).toBe('error');
      expect(we.trace.error?.message).toBe('nope');
      expect(we.trace.finishedAt).toBeGreaterThanOrEqual(we.trace.startedAt);
    }
  });

  it('records the failing node step in the trace when a node throws', async () => {
    @Injectable()
    class FailingNode extends Node<void, void> {
      // eslint-disable-next-line @typescript-eslint/require-await
      async execute() {
        throw new Error('node-failure');
      }
    }

    const localMod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [FailingNode],
    }).compile();
    const localEngine = localMod.get(WorkflowEngine);

    const wf: WorkflowFn<void, void> = async function uncaughtWf(_input, ctx) {
      await ctx.run(FailingNode, undefined);
    };

    try {
      await localEngine.run(wf, undefined);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      const we = e as WorkflowError;
      expect(we.trace.steps).toHaveLength(1);
      expect(we.trace.steps[0]).toMatchObject({
        kind: 'node',
        name: 'FailingNode',
        status: 'error',
        error: { message: 'node-failure' },
      });
    } finally {
      await localMod.close();
    }
  });

  it('continues execution when workflow catches the node error', async () => {
    @Injectable()
    class BoomNode extends Node<void, void> {
      // eslint-disable-next-line @typescript-eslint/require-await
      async execute() {
        throw new Error('boom');
      }
    }

    const localMod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [BoomNode, GreetNode],
    }).compile();
    try {
      const localEngine = localMod.get(WorkflowEngine);

      const wf: WorkflowFn<void, string> = async function recoverWf(
        _input,
        ctx,
      ) {
        try {
          await ctx.run(BoomNode, undefined);
        } catch {
          // swallow
        }
        return ctx.run(GreetNode, { name: 'bob' });
      };

      const { result, trace } = await localEngine.run(wf, undefined);
      expect(result).toBe('hi bob');
      expect(trace.status).toBe('ok');
      expect(trace.steps).toHaveLength(2);
      expect(trace.steps[0]).toMatchObject({
        name: 'BoomNode',
        status: 'error',
      });
      expect(trace.steps[1]).toMatchObject({ name: 'GreetNode', status: 'ok' });
    } finally {
      await localMod.close();
    }
  });
});

describe('WorkflowEngine — sub-workflows', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [GreetNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
  });

  afterEach(async () => {
    await mod.close();
  });

  it('runs a sub-workflow through the engine and nests its trace', async () => {
    const childWf: WorkflowFn<{ name: string }, string> =
      async function childWf(input, ctx) {
        return ctx.run(GreetNode, { name: input.name });
      };

    const parentWf: WorkflowFn<{ name: string }, string> =
      async function parentWf(input, ctx) {
        return ctx.runWorkflow(childWf, { name: input.name });
      };

    const { result, trace } = await engine.run(parentWf, { name: 'carol' });

    expect(result).toBe('hi carol');
    expect(trace.workflowName).toBe('parentWf');
    expect(trace.status).toBe('ok');
    expect(trace.steps).toHaveLength(1);
    const step = trace.steps[0];
    expect(step.kind).toBe('subworkflow');
    if (step.kind !== 'subworkflow') throw new Error('unreachable');
    expect(step.name).toBe('childWf');
    expect(step.status).toBe('ok');
    expect(step.output).toBe('hi carol');
    expect(step.trace.status).toBe('ok');
    expect(step.trace.steps).toHaveLength(1);
    expect(step.trace.steps[0]).toMatchObject({
      kind: 'node',
      name: 'GreetNode',
      status: 'ok',
    });
  });
});
