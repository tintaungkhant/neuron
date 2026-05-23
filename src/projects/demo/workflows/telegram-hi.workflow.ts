import {
  AiAgentNode,
  OpenRouterChatModel,
  PgChatMemory,
  type WorkflowFn,
} from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import { demoConfig } from '../demo.config';

export const demoTelegramHiWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function demoTelegramHiWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);
    if (!parsed.text) return;

    const agent = await wf.run(AiAgentNode, {
      payload: {
        input: parsed.text,
        sessionId: `${demoConfig.id}:${parsed.chat.id}`,
      },
      systemPrompt: 'You are a helpful assistant.',
      chatModel: new OpenRouterChatModel({
        apiKey: demoConfig.openRouterApiKey,
        model: demoConfig.openRouterModel,
      }),
      memory: new PgChatMemory(),
    });

    await wf.run(TelegramSendMessageNode, {
      botToken: demoConfig.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
