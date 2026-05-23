import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { WorkflowEngine, PgChatMemory, type WorkflowFn } from '../../../engine';
import { makeTelegramWorkflow } from '../workflows/telegram.workflow';
import { allInOneDMConfig } from '../allinonedm.config';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';

@Controller('api/allinonedm/telegram')
export class AllInOneDmTelegramController {
  private readonly logger = new Logger(AllInOneDmTelegramController.name);
  private readonly workflow: WorkflowFn<
    WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>,
    void
  >;

  constructor(
    private readonly engine: WorkflowEngine,
    memory: PgChatMemory,
  ) {
    this.workflow = makeTelegramWorkflow(memory);
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() payload: TelegramWebhookPayload) {
    try {
      return await this.engine.run(this.workflow, {
        project: {
          id: 'allinonedm',
          config: allInOneDMConfig,
        },
        payload,
      });
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
