import { formatTrace } from './trace-format';
import type { Trace } from './trace';

describe('formatTrace', () => {
  it('renders an n8n-style flow with per-step timing and surfaced tool calls', () => {
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
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: { output: 'hi', messages: [], toolCalls: ['get_services'] },
          startedAt: 1002,
          finishedAt: 2100,
          status: 'ok',
        },
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

    expect(formatTrace(trace)).toBe(
      'demoTelegramHiWorkflow ✓ 1200ms\n' +
        '  telegram webhook (2ms) → ai agent (1098ms) → get services → telegram send message (100ms)',
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
          name: 'AiAgentNode',
          input: {},
          output: { output: 'hi', messages: [], toolCalls: [] },
          startedAt: 1002,
          finishedAt: 2100,
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
        '  telegram webhook (2ms) → ai agent (1098ms) → telegram send message ✗ (100ms)\n' +
        '  └ sendMessage failed: 403 forbidden',
    );
  });

  it('flattens sub-workflow steps into the flow', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 30,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'subworkflow',
          name: 'childWf',
          input: {},
          startedAt: 0,
          finishedAt: 20,
          status: 'ok',
          trace: {
            workflowName: 'childWf',
            startedAt: 0,
            finishedAt: 20,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'StepOneNode',
                input: {},
                startedAt: 0,
                finishedAt: 10,
                status: 'ok',
              },
            ],
          },
        },
        {
          kind: 'node',
          name: 'StepTwoNode',
          input: {},
          startedAt: 20,
          finishedAt: 30,
          status: 'ok',
        },
      ],
    };

    expect(formatTrace(trace)).toBe(
      'parent ✓ 30ms\n  step one (10ms) → step two (10ms)',
    );
  });
});
