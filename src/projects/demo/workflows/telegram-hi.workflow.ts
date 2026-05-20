import type { WorkflowFn } from '../../../engine';
import { TelegramInNode } from '../../../shared/nodes/telegram-in.node';
import { SayHiNode } from '../../../shared/nodes/say-hi.node';
import type { TelegramUpdate, TriggerInput } from '../../project.types';
import type { DemoConfig } from '../demo.config';

export const demoTelegramHiWf: WorkflowFn<
  TriggerInput<DemoConfig, TelegramUpdate>,
  void
> = async function demoTelegramHiWf(input, ctx) {
  const parsed = await ctx.run(TelegramInNode, input.payload);
  await ctx.run(SayHiNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chatId,
    text: 'hi',
  });
};
