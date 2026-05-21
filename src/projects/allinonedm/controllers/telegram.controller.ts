import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { WorkflowEngine } from '../../../engine';
import { telegramWorkflow } from '../workflows/telegram.workflow';
import { allInOneDMConfig } from '../allinonedm.config';

@Controller('api/allinonedm/telegram')
export class AllInOneDmTelegramController {
  private readonly logger = new Logger(AllInOneDmTelegramController.name);

  constructor(private readonly engine: WorkflowEngine) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: TelegramWebhookPayload) {
    try {
        return await this.engine.run(telegramWorkflow, {
            project: {
                id: "allinonedm",
                config: allInOneDMConfig
            },
            payload
        })
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
