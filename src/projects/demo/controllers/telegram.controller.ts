import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { WorkflowEngine } from '../../../engine';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { demoTelegramHiWorkflow } from '../workflows/telegram-hi.workflow';

@Controller('api/demo/telegram')
export class DemoTelegramController {
  private readonly logger = new Logger(DemoTelegramController.name);

  constructor(private readonly engine: WorkflowEngine) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TelegramWebhookPayload): Promise<{ ok: true }> {
    try {
      await this.engine.run(demoTelegramHiWorkflow, update);
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
