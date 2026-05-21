import { Module } from '@nestjs/common';
import { AllInOneDmTelegramController } from './controllers/telegram.controller';
import { EngineModule } from '../../engine';
import { TelegramWebhookNode } from '../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';

@Module({
  imports: [EngineModule],
  controllers: [AllInOneDmTelegramController],
  providers: [TelegramWebhookNode, TelegramSendMessageNode],
})
export class AllInOneDmModule {}
