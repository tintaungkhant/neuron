import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { WorkflowEngine, PgChatMemory, type WorkflowFn } from '../../../engine';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { demoConfig } from '../demo.config';
import type { DemoConfig } from '../demo.config';
import type { WorkflowInput } from '../../project.types';
import { makeDemoTelegramHiWorkflow } from '../workflows/telegram-hi.workflow';

@Controller('api/demo/telegram')
export class DemoTelegramController {
  private readonly logger = new Logger(DemoTelegramController.name);
  private readonly workflow: WorkflowFn<
    WorkflowInput<DemoConfig, TelegramWebhookPayload>,
    void
  >;

  constructor(
    private readonly engine: WorkflowEngine,
    memory: PgChatMemory,
  ) {
    this.workflow = makeDemoTelegramHiWorkflow(memory);
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TelegramWebhookPayload): Promise<{ ok: true }> {
    try {
      await this.engine.run(this.workflow, {
        project: { id: 'demo', config: demoConfig },
        payload: update,
      });
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
