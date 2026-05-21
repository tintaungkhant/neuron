import { WorkflowFn } from "../../../engine";
import { TelegramSendMessageNode } from "../../../engine/nodes/telegram/send-message.node";
import { TelegramWebhookNode, type TelegramWebhookPayload } from "../../../engine/nodes/telegram/webhook.node";
import { WorkflowInput } from "../../project.types";
import { AllInOneDMConfig } from "../allinonedm.config";

export const telegramWorkflow: WorkflowFn<
  WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>,
  void
> = async function demoTelegramHiWf(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  await ctx.run(TelegramSendMessageNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chat.id,
    text: 'hi',
  });
};