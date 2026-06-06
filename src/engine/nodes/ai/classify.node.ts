import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';

const DEFAULT_HISTORY_WINDOW = 6;

export interface ClassifyOption {
  label: string;
  description: string;
}

export interface ClassifyInput {
  input: string;
  history?: ChatMessage[];
  options: ClassifyOption[];
  chatModel: ChatModel;
  instructions?: string; // optional preamble prepended to the classify prompt
  historyWindow?: number; // recent messages to include; default 6
}

export interface ClassifyOutput {
  label: string;
}

@Injectable()
export class ClassifyNode extends Node<ClassifyInput, ClassifyOutput> {
  async execute(input: ClassifyInput): Promise<ClassifyOutput> {
    const { options } = input;
    if (options.length === 0) {
      throw new Error('ClassifyNode: options must not be empty');
    }

    const window = input.historyWindow ?? DEFAULT_HISTORY_WINDOW;
    const recent: ChatMessage[] = (input.history ?? []).slice(-window);

    const optionLines = options
      .map((o) => `- ${o.label}: ${o.description}`)
      .join('\n');
    const historyText = recent.length
      ? recent.map((m) => `${m.role}: ${m.content}`).join('\n')
      : '(no prior messages)';

    const prompt =
      (input.instructions ? `${input.instructions}\n\n` : '') +
      `Classify the customer's latest message into exactly ONE of these labels:\n` +
      `${optionLines}\n\n` +
      `Recent conversation:\n${historyText}\n\n` +
      `Latest message:\n${input.input}\n\n` +
      `Reply with ONLY the single best-matching label, exactly as written above, and nothing else.`;

    const res = await input.chatModel.complete({
      messages: [{ role: 'user', content: prompt }],
    });

    return { label: resolveLabel(res.message.content, options) };
  }
}

// Map the model's reply to a known label: exact match (case-insensitive)
// first, then substring containment. Anything unrecognized → the first
// option, which the caller orders to be the safe default.
function resolveLabel(raw: string, options: ClassifyOption[]): string {
  const text = raw.trim().toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === text);
  if (exact) return exact.label;
  const contained = options.find((o) => text.includes(o.label.toLowerCase()));
  if (contained) return contained.label;
  return options[0].label;
}
