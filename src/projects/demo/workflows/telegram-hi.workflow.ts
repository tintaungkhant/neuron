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
import type { DemoConfig } from '../demo.config';

export function makeDemoTelegramHiWorkflow(
  memory: ChatMemory,
): WorkflowFn<WorkflowInput<DemoConfig, TelegramWebhookPayload>, void> {
  return async function demoTelegramHiWorkflow(input, wf) {
    const parsed = await wf.run(TelegramWebhookNode, input.payload);
    if (!parsed.text) return;

    const agent = await wf.run(AiAgentNode, {
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

    await wf.run(TelegramSendMessageNode, {
      botToken: input.project.config.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
}
