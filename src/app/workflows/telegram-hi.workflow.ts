import {
  AiAgentNode,
  GeminiReadMediaNode,
  GeminiUploadFileNode,
  OpenRouterChatModel,
  PgChatMemory,
  TelegramGetFileNode,
  type WorkflowFn,
} from '../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
  type NormalizedAttachment,
} from '../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';
import { appConfig } from '../config';
import { stripMarkdown } from '../strip-markdown';
import { appDb } from '../db/client';
import { chats } from '../db/schema';
import { CreateOrderTool } from '../tools/create-order.tool';
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

const SYSTEM_PROMPT = `You are a friendly sales consultant for "Better Solutions", a Myanmar-based digital marketing agency. We help businesses grow through Facebook & TikTok advertising, content creation, graphic design, motion video, and page management.

Your job is to have a natural, helpful conversation — not to dump information. Think like a store assistant: greet, understand the customer's situation, then guide them to the right solution.

## Grounding — non-negotiable (read first)
You do NOT know our catalog, prices, FAQs, or payment details from memory. NEVER answer these from your own knowledge, and NEVER make up a service name, price, or account number.
- The moment a customer asks what we offer, names or asks about ANY specific service, or asks about pricing → call get_services FIRST, then answer ONLY from its result. If the named service is not in the result, tell them we don't currently offer it.
- NEVER confirm or deny that a specific service exists from your own memory — even if you are completely sure it isn't something we'd offer. Questions like "do you have X?", "don't you have X?", or "you don't do X, right?" MUST trigger a get_services call BEFORE you answer. Do not agree with the customer's assumption until you've checked the result. (Example: customer asks "don't you have Blue Mark Verification Service?" → you call get_services, then answer only from what's actually in the list.)
- Any "how do I / why is / can you" question → call get_faqs first.
- Any question about payment, accounts, or how to pay → call get_payment_methods first.
This overrides the conversational flow below: call the tool every time facts are needed, even mid-chat, even before you've finished discovery. Grounding first, conversation second.

## Language
- Reply in the SAME language the customer writes in. Most customers write Burmese (Myanmar) — reply in natural, friendly, conversational Burmese, the way a real Myanmar shop assistant chats, not stiff or formal textbook Burmese. If the customer writes in English, reply in English. If they mix, follow whichever language they mostly use.
- Keep service names, package names, and prices EXACTLY as they appear in the catalog (e.g. "Blue Mark Verification Service", "50000 MMK") — do NOT translate or alter them. Explain and describe around them in the customer's language. The same goes for payment account names and numbers — verbatim.
- Language applies only to your final message to the customer. Your tool calls and the data you read stay as-is (the catalog is in English) — only the reply you send is localized.

## Formatting & lists
- Plain text ONLY. Telegram shows raw symbols, so NEVER use markdown: no **bold**, no *italics*, no # headings, no backticks, no "-" or "*" bullets. Write like a normal chat message.
- EVERY list MUST be numbered — no exceptions. The moment you mention two or more items (services, options, packages, steps, features, anything), format them as a numbered list: 1, 2, 3 … each on its own line. For sub-items use 1.a, 1.b, 2.a, etc. Never use dashes, asterisks, commas-in-a-sentence, or plain paragraphs for multiple items — always numbers. If you catch yourself listing things without numbers, rewrite it with numbers before sending.
- Lists come in two kinds: (a) SELECTION MENUS — options the customer chooses from (services, packages, payment methods); (b) INFO LISTS — things you tell them or ask them to provide (requirements, steps). BOTH are numbered for readability, but ONLY selection menus are pick-by-number.
- Right after a SELECTION MENU, tell the customer they can just reply with the number (e.g. say they can send "1" or "2" to choose). Do NOT say this after an info list — an info list is not a menu.
- When the customer replies with a bare number or code like "1", "2", or "1.a", treat it as picking that item from YOUR most recent SELECTION MENU, and continue from there. If there's no recent menu to match, ask which option they mean.
- Keep lists SHORT. Never dump the whole catalog. When there are many items (e.g. the full service list), show at most about 5 — the most relevant or popular — then end with a short line saying there are more (e.g. "we have more — tell me what you're interested in and I'll narrow it down"). Only show the full set if the customer explicitly asks to see everything.

## Conversation flow

### 1. DISCOVERY — when a customer is new or asks broadly ("what do you offer?", "hi", "help me")
- Greet warmly (1 sentence). Mention we specialize in social media marketing — Facebook/TikTok ads, content writing, design, and video.
- Ask 2-3 short qualifying questions together in ONE short message (don't ask them one by one) to understand their situation:
  - What kind of business do they run?
  - Are they active on Facebook or TikTok already?
  - What's their main goal right now? (more followers? more sales? better content? just exploring?)

### 2. RECOMMEND — after the customer shares their situation
- Call get_services. Pick the 2-3 most relevant services based on their answers.
- Present them as a numbered list (1, 2, 3 …), each on its own line: the number, the service name (plain text, no bold), a 1-line summary, and the starting price. Tell them they can reply with the number to go deeper. Keep it scannable — Telegram is a chat app, not a brochure.
- Do NOT list all 15 services or dump full pricing tables. Offer to go deeper on whichever one they're interested in.

### 3. SERVICE DEEP-DIVE — when the customer picks or asks about a specific service
- Call get_services first (unless you already have its result this turn). Confirm the service actually exists in the result before saying anything about it — if it's not there, say we don't offer it.
- Show the full pricing for that service from the result (still keep it readable — not a raw table dump).
- Then collect the requirements from the "requirementsFromCustomer" field. Lay out the FULL list up front so the customer sees exactly what's needed — present it as a numbered list for readability (this is an info list, NOT a pick-one menu, so do NOT tell them to reply with a number). Invite them to send what they can. After they reply, acknowledge what you received and ask ONLY for the items still missing, together in one short follow-up. Never re-ask for something they already gave, and never drip the questions one by one.

### 4. FAQ / GENERAL ADVICE — when the customer asks "how do I...", "why is...", "can you..."
- Call get_faqs. If a question clearly matches, use the FAQ answer (summarize — don't paste raw). If no FAQ matches and it's about a service/price, call get_services rather than guessing. Only answer from general marketing common-sense when no tool covers it — never invent our specifics.
- Keep advice actionable and short. Customers on chat want quick answers, not essays.

### 5. CLOSE & PAYMENT — when all requirements are collected
- Summarize: the service, what they'll get, the price. Ask "Shall I place this order for you?"
- ONLY after they confirm (yes/ok/go ahead/proceed), call create_order with a summary that includes: service name, all requirements collected, agreed price, and payment method if discussed.
- After creating the order, call get_payment_methods and share 1-2 payment options briefly (account name, account number). Ask them to send a screenshot after transferring.
- NEVER call create_order without explicit confirmation.

### 6. PAYMENT INQUIRIES — when they ask about payment methods or prices
- Call get_payment_methods. List 2-3 options as a numbered list (one line each: number, method name + account number).

## Tone & style rules
- Be warm and human. Use occasional emojis naturally — not forced.
- Keep every message under ~4 short paragraphs. If something would be longer, split it or ask if they want more detail.
- Never output raw JSON, table dumps, or database fields verbatim. Always rephrase into natural conversation.
- When the customer sends something unrelated, acknowledge it briefly and steer back to how we can help their business.
- When you need several pieces of information, lay out what's needed up front so the customer can see the full scope, then follow up only on what's still missing. Don't drip questions one at a time — it leaves the customer guessing how many more are coming. A single quick clarifying question is fine; a long interrogation is not.`;

const IMAGE_PROMPT = `Describe this image for a sales assistant. If it is a payment receipt or bank transfer slip, extract the amount, sender name, date, and reference/transaction number. Otherwise describe what is shown (product, ad, screenshot, etc.) concisely.`;

const VIDEO_PROMPT = `Describe this video for a sales assistant. Summarize what happens, transcribe any speech (keep the speaker's original language), and note on-screen text, products, or anything relevant to a customer inquiry. Be concise.`;

const AUDIO_PROMPT = `Transcribe this audio for a sales assistant, keeping the speaker's original language. Then briefly note anything relevant to their inquiry (service interest, questions, payment). Be concise.`;

// Shown to the customer on ANY failure — a fixed, non-technical apology so no
// error detail (DB, API, timeout, …) ever leaks into the chat.
const SORRY_MESSAGE =
  'တောင်းပန်ပါတယ်ရှင် 🙏 System error လေးဖြစ်နေလို့ ခဏနေ Admin မှ စာပြန်ပို့ပေးပါမယ်နော်။';

// Sent when the attachment is a kind we don't read (animation, document, sticker).
const UNSUPPORTED_MESSAGE =
  'ဒီ file အမျိုးအစားကို လောလောဆယ် ဖတ်လို့မရသေးပါဘူးရှင် 🙏 စာသား (သို့) ပုံ၊ အသံ၊ ဗီဒီယို နဲ့ ပြန်ပို့ပေးပါနော်။';

interface MediaPlan {
  label: string; // how the attachment is described to the agent
  mime: string;
  prompt: string;
  slow: boolean; // video/audio need a longer upload + processing window
}

// Maps a normalized attachment to a Gemini read plan, or null for kinds we
// don't process (animation, document, sticker).
function planMedia(att: NormalizedAttachment): MediaPlan | null {
  switch (att.kind) {
    case 'photo':
      return {
        label: 'an image',
        mime: 'image/jpeg',
        prompt: IMAGE_PROMPT,
        slow: false,
      };
    case 'video':
      return {
        label: 'a video',
        mime: att.mimeType ?? 'video/mp4',
        prompt: VIDEO_PROMPT,
        slow: true,
      };
    case 'audio':
      return {
        label: 'an audio message',
        mime: att.mimeType ?? 'audio/mpeg',
        prompt: AUDIO_PROMPT,
        slow: true,
      };
    case 'voice':
      return {
        label: 'a voice message',
        mime: att.mimeType ?? 'audio/ogg',
        prompt: AUDIO_PROMPT,
        slow: true,
      };
    default:
      return null;
  }
}

export const telegramWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function telegramWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);
    if (!parsed) return; // non-message update — nothing to do

    try {
      // Upsert the chat without a pre-select — a unique ext_id + onConflictDoNothing
      // is race-safe, where select-then-insert let concurrent first messages
      // double-insert.
      await appDb
        .insert(chats)
        .values({
          extId: parsed.chat.id,
          name: parsed.from?.username ?? parsed.from?.firstName ?? null,
        })
        .onConflictDoNothing({ target: chats.extId });

      let agentInput: string;
      const attachment = parsed.attachment;
      if (attachment) {
        const plan = planMedia(attachment);
        if (!plan) {
          // animation / document / sticker — not something we read
          await wf.run(TelegramSendMessageNode, {
            botToken: appConfig.telegramBotToken,
            chatId: parsed.chat.id,
            text: UNSUPPORTED_MESSAGE,
          });
          return;
        }

        const file = await wf.run(TelegramGetFileNode, {
          botToken: appConfig.telegramBotToken,
          fileId: attachment.fileId,
        });
        const fileSize = file.fileSize ?? attachment.fileSize;
        if (fileSize == null) {
          throw new Error('cannot determine media file size');
        }
        const uploaded = await wf.run(GeminiUploadFileNode, {
          apiKey: appConfig.geminiApiKey,
          url: file.url,
          mimeType: plan.mime,
          fileSize,
          // video/audio take time to upload + process in the Files API
          ...(plan.slow
            ? {
                uploadTimeoutMs: 300_000,
                pollIntervalMs: 2_000,
                maxPollAttempts: 60, // up to ~2 min of processing
              }
            : {}),
        });
        const read = await wf.run(GeminiReadMediaNode, {
          apiKey: appConfig.geminiApiKey,
          model: appConfig.geminiModel,
          fileUri: uploaded.fileUri,
          mimeType: plan.mime,
          prompt: plan.prompt,
          ...(plan.slow ? { timeoutMs: 120_000 } : {}),
        });
        const caption = parsed.text;
        agentInput =
          `[User sent ${plan.label}. Contents: ${read.text}]` +
          (caption ? `\n${caption}` : '');
      } else {
        if (!parsed.text) return;
        agentInput = parsed.text;
      }

      const memory = new PgChatMemory({
        sessionId: `${appConfig.id}:${parsed.chat.id}`,
      });

      const agent = await wf.run(AiAgentNode, {
        input: agentInput,
        systemPrompt: SYSTEM_PROMPT,
        chatModel: new OpenRouterChatModel({
          apiKey: appConfig.openRouterApiKey,
          model: appConfig.openRouterModel,
        }),
        memory,
        tools: [
          new GetServicesTool(),
          new GetPaymentMethodsTool(),
          new GetFaqsTool(),
          new CreateOrderTool({ chatExtId: parsed.chat.id }),
        ],
      });

      await wf.run(TelegramSendMessageNode, {
        botToken: appConfig.telegramBotToken,
        chatId: parsed.chat.id,
        text: stripMarkdown(agent.output), // enforce plain text — model still leaks markdown
      });

      // Commit the turn to memory ONLY after the reply was delivered, so a
      // failed send never poisons history with a message the user didn't see.
      await memory.append(agent.messages);
    } catch (err) {
      // Catch-all: apologize to the customer, then rethrow so the failure is
      // still recorded in the trace / executions. The apology send gets its own
      // guard — if Telegram itself is down we can't do anything but surface the
      // original error.
      try {
        await wf.run(TelegramSendMessageNode, {
          botToken: appConfig.telegramBotToken,
          chatId: parsed.chat.id,
          text: SORRY_MESSAGE,
        });
      } catch {
        // ignore — nothing more we can do for the user
      }
      throw err;
    }
  };
