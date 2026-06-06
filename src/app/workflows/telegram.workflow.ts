import { PgChatMemory, type WorkflowFn } from '../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../engine/nodes/telegram/webhook.node';
import { TelegramGetFileNode } from '../../engine/nodes/telegram/get-file.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';
import { appConfig } from '../config';
import { appDb } from '../db/client';
import { chats } from '../db/schema';
import { planMedia, readAttachment } from '../media/read-attachment';
import { conversationWorkflow } from '../conversation/conversation.workflow';

// Shown to the customer on ANY failure — a fixed, non-technical apology so no
// error detail (DB, API, timeout, …) ever leaks into the chat.
const SORRY_MESSAGE =
  'တောင်းပန်ပါတယ်ရှင် 🙏 System error လေးဖြစ်နေလို့ ခဏနေ Admin မှ စာပြန်ပို့ပေးပါမယ်နော်။';

// Sent when the attachment is a kind we don't read (animation, document, sticker).
const UNSUPPORTED_MESSAGE =
  'ဒီ file အမျိုးအစားကို လောလောဆယ် ဖတ်လို့မရသေးပါဘူးရှင် 🙏 စာသား (သို့) ပုံ၊ အသံ၊ ဗီဒီယို နဲ့ ပြန်ပို့ပေးပါနော်။';

export const telegramWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function telegramWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);
    if (!parsed) return; // non-message update — nothing to do

    try {
      // Upsert the chat without a pre-select — a unique ext_id + onConflictDoNothing
      // is race-safe. Runs for EVERY message (even no-text / unsupported), so the
      // chat is always registered.
      await appDb
        .insert(chats)
        .values({
          extId: parsed.chat.id,
          name: parsed.from?.username ?? parsed.from?.firstName ?? null,
        })
        .onConflictDoNothing({ target: chats.extId });

      let agentText: string;
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
        const text = await readAttachment(wf, {
          fileUrl: file.url,
          fileSize,
          plan,
          geminiApiKey: appConfig.geminiApiKey,
          geminiModel: appConfig.geminiModel,
        });
        const caption = parsed.text;
        agentText =
          `[User sent ${plan.label}. Contents: ${text}]` +
          (caption ? `\n${caption}` : '');
      } else {
        if (!parsed.text) return;
        agentText = parsed.text;
      }

      const sessionId = `${appConfig.id}:${parsed.chat.id}`;
      const result = await wf.runWorkflow(conversationWorkflow, {
        sessionId,
        chatExtId: parsed.chat.id,
        text: agentText,
      });

      await wf.run(TelegramSendMessageNode, {
        botToken: appConfig.telegramBotToken,
        chatId: parsed.chat.id,
        text: result.reply,
      });

      // Commit the turn to memory ONLY after the reply was delivered, so a
      // failed send never poisons history with a message the user didn't see.
      await new PgChatMemory({ sessionId }).append(result.messages);
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
