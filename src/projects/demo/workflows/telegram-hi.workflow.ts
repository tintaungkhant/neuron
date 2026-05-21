import type { WorkflowFn } from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { DemoConfig } from '../demo.config';

export const demoTelegramHiWf: WorkflowFn<
  WorkflowInput<DemoConfig, TelegramWebhookPayload>,
  void
> = async function demoTelegramHiWf(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  await ctx.run(TelegramSendMessageNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chat.id,
    text: 'hi',
  });
};
