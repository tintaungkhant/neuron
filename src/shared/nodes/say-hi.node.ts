import { Injectable, Logger } from '@nestjs/common';
import { Node } from '../../engine';

export type SayHiInput = {
  botToken: string;
  chatId: number;
  text: string;
};

@Injectable()
export class SayHiNode extends Node<SayHiInput, void> {
  private readonly logger = new Logger(SayHiNode.name);

  async execute(input: SayHiInput): Promise<void> {
    const url = `https://api.telegram.org/bot${input.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendMessage failed: ${res.status} ${body}`);
    }

    this.logger.log(`replied to chat ${input.chatId}: "${input.text}"`);
  }
}
