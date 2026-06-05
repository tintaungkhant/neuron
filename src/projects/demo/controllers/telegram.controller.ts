import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import {
  WorkflowEngine,
  WorkflowError,
  ExecutionStore,
  enrichTrace,
  formatTrace,
  type Trace,
} from '../../../engine';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { demoTelegramHiWorkflow } from '../workflows/telegram-hi.workflow';

@Controller('api/demo/telegram')
export class DemoTelegramController {
  private readonly logger = new Logger(DemoTelegramController.name);

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly executions: ExecutionStore,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TelegramWebhookPayload): Promise<{ ok: true }> {
    try {
      const { trace } = await this.engine.run(demoTelegramHiWorkflow, update);
      await this.record(trace);
    } catch (e) {
      // WorkflowError carries the partial trace — record the flow up to the break.
      if (e instanceof WorkflowError) {
        await this.record(e.trace);
      } else {
        this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
      }
    }
    return { ok: true };
  }

  private async record(trace: Trace): Promise<void> {
    this.logger.log('\n' + formatTrace(enrichTrace(trace)));
    try {
      const id = await this.executions.save(trace);
      this.logger.log(`execution #${id} saved`);
    } catch (e) {
      // Persistence must never break the webhook response.
      this.logger.error(
        'failed to save execution',
        e instanceof Error ? e.stack : e,
      );
    }
  }
}
