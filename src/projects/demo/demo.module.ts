import { Module } from '@nestjs/common';
import { EngineModule } from '../../engine';
import { TelegramWebhookNode } from '../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';
import { DemoTelegramController } from './controllers/telegram.controller';

@Module({
  imports: [EngineModule],
  controllers: [DemoTelegramController],
  providers: [TelegramWebhookNode, TelegramSendMessageNode],
})
export class DemoModule {}
