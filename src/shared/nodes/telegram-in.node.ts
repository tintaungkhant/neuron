import { Injectable } from '@nestjs/common';
import { Node } from '../../engine';
import type { TelegramUpdate } from '../../projects/project.types';

export type TelegramInOutput = {
  chatId: number;
  text: string;
};

@Injectable()
export class TelegramInNode extends Node<TelegramUpdate, TelegramInOutput> {
  execute(input: TelegramUpdate): Promise<TelegramInOutput> {
    const chatId = input.message?.chat.id ?? 0;
    const text = input.message?.text ?? '';
    return Promise.resolve({ chatId, text });
  }
}
