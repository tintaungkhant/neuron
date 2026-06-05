import { eq } from 'drizzle-orm';
import {
  AiAgentNode,
  GeminiReadImageNode,
  GeminiUploadFileNode,
  OpenRouterChatModel,
  PgChatMemory,
  TelegramGetFileNode,
  type WorkflowFn,
} from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import { demoConfig } from '../demo.config';
import { demoDb } from '../db/client';
import { chats } from '../db/schema';
import { CreateOrderTool } from '../tools/create-order.tool';
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

const SYSTEM_PROMPT = `You are a friendly sales consultant for "Better Solutions", a Myanmar-based digital marketing agency. We help businesses grow through Facebook & TikTok advertising, content creation, graphic design, motion video, and page management.

Your job is to have a natural, helpful conversation — not to dump information. Think like a store assistant: greet, understand the customer's situation, then guide them to the right solution.

## Conversation flow

### 1. DISCOVERY — when a customer is new or asks broadly ("what do you offer?", "hi", "help me")
- Greet warmly (1 sentence). Mention we specialize in social media marketing — Facebook/TikTok ads, content writing, design, and video.
- Ask 2-3 short qualifying questions to understand their situation:
  - What kind of business do they run?
  - Are they active on Facebook or TikTok already?
  - What's their main goal right now? (more followers? more sales? better content? just exploring?)

### 2. RECOMMEND — after the customer shares their situation
- Call get_services. Pick the 2-3 most relevant services based on their answers.
- Present them like a menu: **service name**, a 1-line summary, and starting price. Keep it scannable — Telegram is a chat app, not a brochure.
- Do NOT list all 15 services or dump full pricing tables. Offer to go deeper on whichever one they're interested in.

### 3. SERVICE DEEP-DIVE — when the customer picks or asks about a specific service
- Show the full pricing for that service (still keep it readable — not a raw table dump).
- Then collect requirements from the "requirementsFromCustomer" field ONE at a time. Don't ask for everything at once. After each answer, acknowledge it and ask the next. This keeps the conversation light.

### 4. FAQ / GENERAL ADVICE — when the customer asks "how do I...", "why is...", "can you..."
- Call get_faqs. If a question clearly matches, use the FAQ answer (summarize — don't paste raw). If no match, answer briefly from your catalog knowledge.
- Keep advice actionable and short. Customers on chat want quick answers, not essays.

### 5. CLOSE & PAYMENT — when all requirements are collected
- Summarize: the service, what they'll get, the price. Ask "Shall I place this order for you?"
- ONLY after they confirm (yes/ok/go ahead/proceed), call create_order with a summary that includes: service name, all requirements collected, agreed price, and payment method if discussed.
- After creating the order, call get_payment_methods and share 1-2 payment options briefly (account name, account number). Ask them to send a screenshot after transferring.
- NEVER call create_order without explicit confirmation.

### 6. PAYMENT INQUIRIES — when they ask about payment methods or prices
- Call get_payment_methods. List 2-3 options concisely (one line each: method name + account number).

## Tone & style rules
- Be warm and human. Use occasional emojis naturally — not forced.
- Keep every message under ~4 short paragraphs. If something would be longer, split it or ask if they want more detail.
- Never output raw JSON, table dumps, or database fields verbatim. Always rephrase into natural conversation.
- When the customer sends something unrelated, acknowledge it briefly and steer back to how we can help their business.
- Prefer asking one question at a time. It keeps the chat flowing naturally.`;

const IMAGE_PROMPT = `Describe this image for a sales assistant. If it is a payment receipt or bank transfer slip, extract the amount, sender name, date, and reference/transaction number. Otherwise describe what is shown (product, ad, screenshot, etc.) concisely.`;

// Telegram delivers photos as JPEG; PhotoSize carries no mime type.
const PHOTO_MIME = 'image/jpeg';

export const demoTelegramHiWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function demoTelegramHiWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);

    const existing = await demoDb
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.extId, parsed.chat.id))
      .limit(1);
    if (existing.length === 0) {
      await demoDb.insert(chats).values({
        extId: parsed.chat.id,
        name: parsed.from?.username ?? parsed.from?.firstName ?? null,
      });
    }

    let agentInput: string;
    const attachment = parsed.attachment;
    if (attachment?.kind === 'photo') {
      const file = await wf.run(TelegramGetFileNode, {
        botToken: demoConfig.telegramBotToken,
        fileId: attachment.fileId,
      });
      const fileSize = file.fileSize ?? attachment.fileSize;
      if (fileSize == null) {
        throw new Error('cannot determine image file size');
      }
      const uploaded = await wf.run(GeminiUploadFileNode, {
        apiKey: demoConfig.geminiApiKey,
        url: file.url,
        mimeType: PHOTO_MIME,
        fileSize,
      });
      const read = await wf.run(GeminiReadImageNode, {
        apiKey: demoConfig.geminiApiKey,
        model: demoConfig.geminiModel,
        fileUri: uploaded.fileUri,
        mimeType: PHOTO_MIME,
        prompt: IMAGE_PROMPT,
      });
      const caption = parsed.text;
      agentInput =
        `[User sent an image. Contents: ${read.text}]` +
        (caption ? `\n${caption}` : '');
    } else {
      if (!parsed.text) return;
      agentInput = parsed.text;
    }

    const agent = await wf.run(AiAgentNode, {
      input: agentInput,
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
        new CreateOrderTool({ chatExtId: parsed.chat.id }),
      ],
    });

    await wf.run(TelegramSendMessageNode, {
      botToken: demoConfig.telegramBotToken,
      chatId: parsed.chat.id,
      text: agent.output,
    });
  };
