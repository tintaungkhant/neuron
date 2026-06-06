import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import { TELEGRAM_QUEUE, PROCESS_UPDATE_JOB } from '../queue/queue.constants';

@Controller('api/demo/telegram')
export class TelegramController {
  constructor(@InjectQueue(TELEGRAM_QUEUE) private readonly queue: Queue) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TelegramWebhookPayload): Promise<{ ok: true }> {
    await this.queue.add(PROCESS_UPDATE_JOB, update, {
      jobId: update?.update_id != null ? String(update.update_id) : undefined,
      attempts: 1,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    return { ok: true };
  }
}
