import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EngineModule } from './engine';
import { TelegramWebhookNode } from './engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from './engine/nodes/telegram/send-message.node';
import { TelegramController } from './app/controllers/telegram.controller';
import { AppDbShutdown } from './app/db/db-shutdown';
import { TelegramProcessor } from './app/queue/telegram.processor';
import { TELEGRAM_QUEUE } from './app/queue/queue.constants';
import { appConfig } from './app/config';

// Parse REDIS_URL into BullMQ connection options. We pass plain options (not an
// ioredis instance) so the type matches BullMQ's own bundled ioredis version.
function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null, // required by BullMQ workers
  };
}

@Module({
  imports: [
    EngineModule,
    BullModule.forRoot({ connection: redisConnection(appConfig.redisUrl) }),
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
  ],
  controllers: [TelegramController],
  providers: [
    TelegramWebhookNode,
    TelegramSendMessageNode,
    AppDbShutdown,
    TelegramProcessor,
  ],
})
export class AppModule {}
