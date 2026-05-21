import { AiAgentNode, OpenRouterChatModel, type WorkflowFn } from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';

export const telegramWorkflow: WorkflowFn<
  WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>,
  void
> = async function telegramWorkflow(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  if (!parsed.text) return;

  const agent = await ctx.run(AiAgentNode, {
    payload: { input: parsed.text, sessionId: String(parsed.chat.id) },
    systemPrompt: 'You are a helpful assistant.',
    chatModel: ctx.get(OpenRouterChatModel),
    tools: [],
  });

  await ctx.run(TelegramSendMessageNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chat.id,
    text: agent.output,
  });
};
