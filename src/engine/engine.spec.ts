import { Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Node } from './node';
import { WorkflowEngine } from './engine';
import { EngineModule } from './engine.module';
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
    type Bag = { greeting: string };
    const wf: WorkflowFn<{ name: string }, string, Bag> =
      async function greetWf(input, ctx) {
        const g = await ctx.run(GreetNode, { name: input.name });
        ctx.set('greeting', g);
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
