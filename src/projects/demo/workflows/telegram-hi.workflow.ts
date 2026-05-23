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
import { GetServicesTool } from '../tools/get-services.tool';

const SYSTEM_PROMPT = `You are sales and support assistant for a digital marketing agency call "Better Solutions".

Help customers learn about our services, answer pricing questions, and collect requirements before quoting. Be concise, friendly, and professional.

When the user asks what services are offered, asks about pricing, or is ready to discuss a specific service, call the get_services tool to fetch the live catalog. Quote service names and prices only from get_services results — never invent a service or price.

Before quoting, gather the items listed in the service's "requirementsFromCustomer" field. If the customer is unsure which service fits, ask a few short questions about their goals and recommend from the catalog.`;

export const demoTelegramHiWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function demoTelegramHiWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);
    if (!parsed.text) return;

    const agent = await wf.run(AiAgentNode, {
      input: parsed.text,
      systemPrompt: SYSTEM_PROMPT,
      chatModel: new OpenRouterChatModel({
        apiKey: demoConfig.openRouterApiKey,
        model: demoConfig.openRouterModel,
      }),
      memory: new PgChatMemory({
        sessionId: `${demoConfig.id}:${parsed.chat.id}`,
      }),
      tools: [new GetServicesTool()],
    });

    await wf.run(TelegramSendMessageNode, {
      botToken: demoConfig.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
