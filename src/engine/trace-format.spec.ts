import {
  formatTrace,
  enrichTrace,
  countSteps,
  truncateTrace,
  sumTokens,
} from './trace-format';
import type { Trace } from './trace';

function agentStep(
  toolSteps: unknown[],
  startedAt: number,
  finishedAt: number,
) {
  return {
    kind: 'node' as const,
    name: 'AiAgentNode',
    input: {},
    output: { output: 'hi', messages: [], toolSteps },
    startedAt,
    finishedAt,
    status: 'ok' as const,
  };
}

describe('enrichTrace', () => {
  it('folds a node output.toolSteps into tool children with in/out preserved', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        agentStep(
          [
            {
              name: 'get_services',
              input: { q: 'x' },
              output: [{ name: 'A' }],
              startedAt: 10,
              finishedAt: 50,
              status: 'ok',
            },
          ],
          5,
          90,
        ),
      ],
    };

    const enriched = enrichTrace(trace);
    const step = enriched.steps[0];
    expect(step.kind).toBe('node');
    if (step.kind !== 'node') throw new Error('expected node');
    expect(step.children).toEqual([
      {
        kind: 'tool',
        name: 'get_services',
        input: { q: 'x' },
        output: [{ name: 'A' }],
        startedAt: 10,
        finishedAt: 50,
        status: 'ok',
      },
    ]);
    // toolSteps stripped from the node output (now lives in children)
    expect(step.output).toEqual({ output: 'hi', messages: [] });
  });

  it('lifts usage off a node output onto the step and strips it', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            output: 'hi',
            messages: [],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          startedAt: 0,
          finishedAt: 100,
          status: 'ok',
        },
      ],
    };

    const step = enrichTrace(trace).steps[0];
    if (step.kind !== 'node') throw new Error('expected node');
    expect(step.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(step.output).toEqual({ output: 'hi', messages: [] });
  });

  it('sets sub-workflow step usage to the child total', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 0,
          finishedAt: 100,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 0,
            finishedAt: 100,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'AiAgentNode',
                input: {},
                output: {
                  usage: {
                    promptTokens: 7,
                    completionTokens: 2,
                    totalTokens: 9,
                  },
                },
                startedAt: 0,
                finishedAt: 100,
                status: 'ok',
              },
            ],
          },
        },
      ],
    };

    const step = enrichTrace(trace).steps[0];
    if (step.kind !== 'subworkflow') throw new Error('expected subworkflow');
    expect(step.usage).toEqual({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
  });

  it('recurses into sub-workflows', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 0,
          finishedAt: 100,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 0,
            finishedAt: 100,
            status: 'ok',
            input: {},
            steps: [
              agentStep(
                [
                  {
                    name: 't',
                    input: {},
                    output: 1,
                    startedAt: 1,
                    finishedAt: 2,
                    status: 'ok',
                  },
                ],
                0,
                100,
              ),
            ],
          },
        },
      ],
    };

    const enriched = enrichTrace(trace);
    const sub = enriched.steps[0];
    if (sub.kind !== 'subworkflow') throw new Error('expected subworkflow');
    const inner = sub.trace.steps[0];
    if (inner.kind !== 'node') throw new Error('expected node');
    expect(inner.children).toHaveLength(1);
  });
});

describe('truncateTrace', () => {
  it('truncates long strings in step input/output, leaves short ones', () => {
    const big = 'x'.repeat(50);
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 10,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'N',
          input: { prompt: big, keep: 'short' },
          output: { text: big },
          startedAt: 0,
          finishedAt: 10,
          status: 'ok',
        },
      ],
    };

    const out = truncateTrace(trace, 10);
    const step = out.steps[0];
    if (step.kind !== 'node') throw new Error('expected node');
    expect(step.input).toEqual({
      prompt: 'xxxxxxxxxx…[+40 chars]',
      keep: 'short',
    });
    expect(step.output).toEqual({ text: 'xxxxxxxxxx…[+40 chars]' });
  });
});

describe('countSteps', () => {
  it('counts nodes, tool children, and sub-workflow steps recursively', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'WebhookNode',
          input: {},
          startedAt: 0,
          finishedAt: 1,
          status: 'ok',
        },
        agentStep(
          [
            {
              name: 'a',
              input: {},
              output: 1,
              startedAt: 1,
              finishedAt: 2,
              status: 'ok',
            },
            {
              name: 'b',
              input: {},
              output: 2,
              startedAt: 2,
              finishedAt: 3,
              status: 'ok',
            },
          ],
          1,
          5,
        ),
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 5,
          finishedAt: 8,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 5,
            finishedAt: 8,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'InnerNode',
                input: {},
                startedAt: 5,
                finishedAt: 6,
                status: 'ok',
              },
            ],
          },
        },
      ],
    };

    // webhook(1) + agent(1) + 2 tool children + subworkflow(1) + inner node(1) = 6
    expect(countSteps(enrichTrace(trace))).toBe(6);
  });
});

describe('sumTokens', () => {
  it('sums node usage and recurses into sub-workflows', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          startedAt: 0,
          finishedAt: 10,
          status: 'ok',
        },
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 10,
          finishedAt: 20,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 10,
            finishedAt: 20,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'GeminiReadMediaNode',
                input: {},
                output: {
                  usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                  },
                },
                startedAt: 10,
                finishedAt: 20,
                status: 'ok',
              },
            ],
          },
        },
      ],
    };

    expect(sumTokens(enrichTrace(trace))).toEqual({
      promptTokens: 110,
      completionTokens: 25,
      totalTokens: 135,
    });
  });

  it('returns zeros for a trace with no usage', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 1,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'TelegramWebhookNode',
          input: {},
          output: {},
          startedAt: 0,
          finishedAt: 1,
          status: 'ok',
        },
      ],
    };

    expect(sumTokens(trace)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});

describe('formatTrace', () => {
  it('renders the flow with per-step timing and surfaced tool steps', () => {
    const trace: Trace = {
      workflowName: 'demoTelegramHiWorkflow',
      startedAt: 1000,
      finishedAt: 2200,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'TelegramWebhookNode',
          input: {},
          output: {},
          startedAt: 1000,
          finishedAt: 1002,
          status: 'ok',
        },
        agentStep(
          [
            {
              name: 'get_services',
              input: {},
              output: [],
              startedAt: 1010,
              finishedAt: 1050,
              status: 'ok',
            },
          ],
          1002,
          2100,
        ),
        {
          kind: 'node',
          name: 'TelegramSendMessageNode',
          input: {},
          startedAt: 2100,
          finishedAt: 2200,
          status: 'ok',
        },
      ],
    };

    expect(formatTrace(enrichTrace(trace))).toBe(
      'demoTelegramHiWorkflow ✓ 1200ms\n' +
        '  telegram webhook (2ms) → ai agent (1098ms) → get services (40ms) → telegram send message (100ms)',
    );
  });

  it('appends token counts per node and for the workflow', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 1000,
      finishedAt: 2000,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            output: 'hi',
            usage: { promptTokens: 30, completionTokens: 9, totalTokens: 39 },
          },
          startedAt: 1000,
          finishedAt: 2000,
          status: 'ok',
        },
      ],
    };

    expect(formatTrace(enrichTrace(trace))).toBe(
      'wf ✓ 1000ms · 39 tok\n  ai agent (1000ms · 39 tok)',
    );
  });

  it('marks the failing step and appends the error reason', () => {
    const trace: Trace = {
      workflowName: 'demoTelegramHiWorkflow',
      startedAt: 1000,
      finishedAt: 2200,
      status: 'error',
      input: {},
      error: { message: 'sendMessage failed: 403 forbidden' },
      steps: [
        {
          kind: 'node',
          name: 'TelegramWebhookNode',
          input: {},
          output: {},
          startedAt: 1000,
          finishedAt: 1002,
          status: 'ok',
        },
        {
          kind: 'node',
          name: 'TelegramSendMessageNode',
          input: {},
          startedAt: 2100,
          finishedAt: 2200,
          status: 'error',
          error: { message: 'sendMessage failed: 403 forbidden' },
        },
      ],
    };

    expect(formatTrace(trace)).toBe(
      'demoTelegramHiWorkflow ✗ 1200ms\n' +
        '  telegram webhook (2ms) → telegram send message ✗ (100ms)\n' +
        '  └ sendMessage failed: 403 forbidden',
    );
  });
});
