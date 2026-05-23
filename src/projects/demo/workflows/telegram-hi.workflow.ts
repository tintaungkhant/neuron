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
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

const SYSTEM_PROMPT = `You are sales and support assistant for a digital marketing agency call "Better Solutions".

Help customers learn about our services, answer pricing questions, collect requirements before quoting, and share payment details when they are ready to pay. Be concise, friendly, and professional.

Tool usage:
- Services / pricing: call get_services to fetch the live catalog. Quote names and prices only from its results — never invent a service or price. Before quoting, gather the items listed in the service's "requirementsFromCustomer" field.
- Payment: call get_payment_methods when the customer asks how to pay, which methods are accepted, or is about to send a payment. Quote account names and account numbers only from its results.
- General questions / advice: when the user asks a general question or seems unsure, call get_faqs first and prefer the matching FAQ answer over your own knowledge. If no FAQ matches, answer briefly from context.

If the customer is unsure which service fits, ask a few short questions about their goals and recommend from the catalog.`;

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
      tools: [
        new GetServicesTool(),
        new GetPaymentMethodsTool(),
        new GetFaqsTool(),
      ],
    });

    await wf.run(TelegramSendMessageNode, {
      botToken: demoConfig.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
