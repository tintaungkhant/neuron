import { Injectable, Logger } from '@nestjs/common';
import { Node } from '../../node';
import { fetchWithTimeout } from '../../http';

const TIMEOUT_MS = 15_000;

export type TelegramSendMessageInput = {
  botToken: string;
  chatId: number;
  text: string;
};

@Injectable()
export class TelegramSendMessageNode extends Node<
  TelegramSendMessageInput,
  void
> {
  private readonly logger = new Logger(TelegramSendMessageNode.name);

  async execute(input: TelegramSendMessageInput): Promise<void> {
    const url = `https://api.telegram.org/bot${input.botToken}/sendMessage`;
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
      },
      TIMEOUT_MS,
      'Telegram sendMessage',
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendMessage failed: ${res.status} ${body}`);
    }

    this.logger.log(`sent to chat ${input.chatId}: "${input.text}"`);
  }
}
