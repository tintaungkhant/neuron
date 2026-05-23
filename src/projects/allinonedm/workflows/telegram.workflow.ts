import {
  AiAgentNode,
  OpenRouterChatModel,
  type ChatMemory,
  type WorkflowFn,
} from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';

export function makeTelegramWorkflow(
  memory: ChatMemory,
): WorkflowFn<WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>, void> {
  return async function telegramWorkflow(input, ctx) {
    const parsed = await ctx.run(TelegramWebhookNode, input.payload);
    if (!parsed.text) return;

    const agent = await ctx.run(AiAgentNode, {
      payload: {
        input: parsed.text,
        sessionId: `${input.project.id}:${parsed.chat.id}`,
      },
      systemPrompt: 'You are a helpful assistant.',
      chatModel: new OpenRouterChatModel({
        apiKey: input.project.config.openRouterApiKey,
        model: input.project.config.openRouterModel,
      }),
      memory,
      tools: [],
    });

    await ctx.run(TelegramSendMessageNode, {
      botToken: input.project.config.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
}
