import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import { GEMINI_BASE, geminiError } from './gemini-http';
import { fetchWithTimeout } from '../../http';

const DEFAULT_TIMEOUT_MS = 60_000;

export interface GeminiReadImageInput {
  apiKey: string;
  model: string;
  fileUri: string;
  mimeType: string;
  prompt: string;
  timeoutMs?: number; // defaults to 60s
}

export interface GeminiReadImageOutput {
  text: string;
}

interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

@Injectable()
export class GeminiReadImageNode extends Node<
  GeminiReadImageInput,
  GeminiReadImageOutput
> {
  async execute(input: GeminiReadImageInput): Promise<GeminiReadImageOutput> {
    const res = await fetchWithTimeout(
      `${GEMINI_BASE}/v1beta/models/${input.model}:generateContent?key=${input.apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  file_data: {
                    mime_type: input.mimeType,
                    file_uri: input.fileUri,
                  },
                },
                { text: input.prompt },
              ],
            },
          ],
        }),
      },
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'Gemini generateContent',
    );
    if (!res.ok) {
      await geminiError('generateContent failed', res);
    }
    const json = (await res.json()) as GenerateContentResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) {
      throw new Error('Gemini returned no text');
    }
    return { text };
  }
}
