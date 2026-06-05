jest.mock('../db/client', () => ({
  db: { insert: jest.fn(), select: jest.fn() },
}));

import { ExecutionStore } from './execution-store';
import { db } from '../db/client';
import type { Trace } from '../trace';

const mockDb = db as unknown as { insert: jest.Mock; select: jest.Mock };

describe('ExecutionStore.save', () => {
  it('enriches the trace, counts steps, and inserts a row', async () => {
    const returning = jest.fn().mockResolvedValue([{ id: 7 }]);
    const values = jest.fn().mockReturnValue({ returning });
    mockDb.insert.mockReturnValue({ values });

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
          output: {
            output: 'hi',
            messages: [],
            toolSteps: [
              {
                name: 'get_services',
                input: {},
                output: [{ name: 'A' }],
                startedAt: 1010,
                finishedAt: 1050,
                status: 'ok',
              },
            ],
          },
          startedAt: 1002,
          finishedAt: 2200,
          status: 'ok',
        },
      ],
    };

    const id = await new ExecutionStore().save(trace);

    expect(id).toBe(7);
    const row = (values.mock.calls[0] as unknown[])[0] as {
      workflowName: string;
      status: string;
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
      stepCount: number;
      trace: Trace;
    };
    expect(row.workflowName).toBe('demoTelegramHiWorkflow');
    expect(row.status).toBe('ok');
    expect(row.durationMs).toBe(1200);
    // webhook(1) + agent(1) + get_services tool child(1) = 3
    expect(row.stepCount).toBe(3);
    expect(row.startedAt).toEqual(new Date(1000));
    expect(row.finishedAt).toEqual(new Date(2200));
    // tool folded into children
    const agent = row.trace.steps[1];
    if (agent.kind !== 'node') throw new Error('expected node');
    expect(agent.children?.[0]).toMatchObject({
      kind: 'tool',
      name: 'get_services',
      output: [{ name: 'A' }],
    });
  });
});
