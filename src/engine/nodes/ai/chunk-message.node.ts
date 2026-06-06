import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatModel } from '../../ai/chat-model';

const DEFAULT_MAX_CHARS = 4096;

export interface ChunkMessageInput {
  text: string;
  chatModel: ChatModel;
  maxChars?: number; // per-message ceiling hinted to the model; default 4096
}

export interface ChunkMessageOutput {
  chunks: string[];
}

@Injectable()
export class ChunkMessageNode extends Node<
  ChunkMessageInput,
  ChunkMessageOutput
> {
  async execute(input: ChunkMessageInput): Promise<ChunkMessageOutput> {
    const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
    const prompt =
      `Split the following chat message into multiple shorter messages at ` +
      `natural topic boundaries. Preserve ALL content exactly — do not reword, ` +
      `summarise, add, or drop anything; only split. Each message must be at ` +
      `most ${maxChars} characters. Return ONLY a JSON array of strings, ` +
      `nothing else.\n\n${input.text}`;

    const res = await input.chatModel.complete({
      messages: [{ role: 'user', content: prompt }],
    });

    return { chunks: parseChunks(res.message.content, input.text) };
  }
}

// Tolerant parse: pull the first '[' … last ']' and require a non-empty array
// of non-empty strings. Anything else → the whole text as a single chunk.
function parseChunks(raw: string, fallback: string): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [fallback];
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((p) => typeof p === 'string' && p.length > 0)
    ) {
      return parsed as string[];
    }
    return [fallback];
  } catch {
    return [fallback];
  }
}
