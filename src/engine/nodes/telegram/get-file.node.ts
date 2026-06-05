import { Injectable } from '@nestjs/common';
import { Node } from '../../node';

export interface TelegramGetFileInput {
  botToken: string;
  fileId: string;
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
    const res = await fetch(url);
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
