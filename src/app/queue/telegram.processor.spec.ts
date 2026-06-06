import { ExecutionStore, WorkflowEngine, WorkflowError } from '../../engine';
import type { Trace } from '../../engine';
import { telegramWorkflow } from '../workflows/telegram-hi.workflow';
import { TelegramProcessor } from './telegram.processor';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import type { Job } from 'bullmq';

function trace(status: 'ok' | 'error' = 'ok'): Trace {
  return {
    workflowName: 'telegramWorkflow',
    startedAt: 0,
    finishedAt: 0,
    status,
    input: {},
    steps: [],
  };
}

const update = { update_id: 7 } as TelegramWebhookPayload;
const job = { data: update } as Job<TelegramWebhookPayload>;

describe('TelegramProcessor', () => {
  it('runs the workflow with the job data and saves the trace', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ result: undefined, trace: trace() });
    const save = jest.fn().mockResolvedValue(1);
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await proc.process(job);

    expect(run).toHaveBeenCalledTimes(1);
    const [wf, input] = run.mock.calls[0] as [unknown, unknown];
    expect(wf).toBe(telegramWorkflow);
    expect(input).toBe(update);
    expect(save).toHaveBeenCalledWith(trace());
  });

  it('records the partial trace and rethrows on WorkflowError', async () => {
    const partial = trace('error');
    const run = jest
      .fn()
      .mockRejectedValue(new WorkflowError(new Error('boom'), partial));
    const save = jest.fn().mockResolvedValue(2);
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await expect(proc.process(job)).rejects.toThrow('boom');
    expect(save).toHaveBeenCalledWith(partial);
  });

  it('rethrows a non-WorkflowError without saving', async () => {
    const run = jest.fn().mockRejectedValue(new Error('infra'));
    const save = jest.fn();
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await expect(proc.process(job)).rejects.toThrow('infra');
    expect(save).not.toHaveBeenCalled();
  });
});
