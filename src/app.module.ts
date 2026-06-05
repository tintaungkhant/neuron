import { Module } from '@nestjs/common';
import { EngineModule } from './engine';
import { TelegramWebhookNode } from './engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from './engine/nodes/telegram/send-message.node';
import { TelegramController } from './app/controllers/telegram.controller';
import { AppDbShutdown } from './app/db/db-shutdown';

@Module({
  imports: [EngineModule],
  controllers: [TelegramController],
  providers: [TelegramWebhookNode, TelegramSendMessageNode, AppDbShutdown],
})
export class AppModule {}
