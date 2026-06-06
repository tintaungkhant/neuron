import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  WorkflowEngine,
  WorkflowError,
  ExecutionStore,
  enrichTrace,
  formatTrace,
  type Trace,
} from '../../engine';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import { telegramWorkflow } from '../workflows/telegram-hi.workflow';
import { appConfig } from '../config';
import { TELEGRAM_QUEUE } from './queue.constants';

@Processor(TELEGRAM_QUEUE, { concurrency: appConfig.queueConcurrency })
export class TelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly executions: ExecutionStore,
  ) {
    super();
  }

  async process(job: Job<TelegramWebhookPayload>): Promise<void> {
    try {
      const { trace } = await this.engine.run(telegramWorkflow, job.data);
      await this.record(trace);
    } catch (e) {
      // WorkflowError carries the partial trace — record the flow up to the break.
      if (e instanceof WorkflowError) {
        await this.record(e.trace);
      } else {
        this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
      }
      throw e; // surface to BullMQ's failed set (no retry: attempts=1)
    }
  }

  private async record(trace: Trace): Promise<void> {
    this.logger.log('\n' + formatTrace(enrichTrace(trace)));
    try {
      const id = await this.executions.save(trace);
      this.logger.log(`execution #${id} saved`);
    } catch (e) {
      // Persistence must never break job processing.
      this.logger.error(
        'failed to save execution',
        e instanceof Error ? e.stack : e,
      );
    }
  }
}
