import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import { fetchWithTimeout } from '../../http';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface TelegramGetFileInput {
  botToken: string;
  fileId: string;
  timeoutMs?: number; // defaults to 15s
}

export interface TelegramGetFileOutput {
  url: string;
  filePath: string;
  fileSize?: number;
}

interface GetFileResponse {
  ok: boolean;
  result?: { file_path?: string; file_size?: number };
}

@Injectable()
export class TelegramGetFileNode extends Node<
  TelegramGetFileInput,
  TelegramGetFileOutput
> {
  async execute(input: TelegramGetFileInput): Promise<TelegramGetFileOutput> {
    const url = `https://api.telegram.org/bot${input.botToken}/getFile?file_id=${encodeURIComponent(
      input.fileId,
    )}`;
    const res = await fetchWithTimeout(
      url,
      {},
      input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'Telegram getFile',
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getFile failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as GetFileResponse;
    const filePath = json.result?.file_path;
    if (!filePath) {
      throw new Error('getFile failed: no file_path in response');
    }
    return {
      url: `https://api.telegram.org/file/bot${input.botToken}/${filePath}`,
      filePath,
      fileSize: json.result?.file_size,
    };
  }
}
