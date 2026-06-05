import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import { GEMINI_BASE, geminiError, sleep } from './gemini-http';
import { fetchWithTimeout } from '../../http';

const TIMEOUT_MS = 30_000; // source fetch, session start, poll
const UPLOAD_TIMEOUT_MS = 120_000; // streaming the bytes can be large/slow

export interface GeminiUploadFileInput {
  apiKey: string;
  url: string;
  mimeType: string;
  fileSize: number;
  displayName?: string;
}

export interface GeminiUploadFileOutput {
  fileUri: string;
  name: string;
  mimeType: string;
  state: string;
}

interface FilesApiFile {
  name: string;
  uri: string;
  mimeType: string;
  state: string;
}

const POLL_DELAY_MS = 1000;
const MAX_POLL_ATTEMPTS = 10;

@Injectable()
export class GeminiUploadFileNode extends Node<
  GeminiUploadFileInput,
  GeminiUploadFileOutput
> {
  async execute(input: GeminiUploadFileInput): Promise<GeminiUploadFileOutput> {
    const src = await fetchWithTimeout(
      input.url,
      {},
      TIMEOUT_MS,
      'image source fetch',
    );
    if (!src.ok || !src.body) {
      await geminiError('upload source fetch failed', src);
    }

    // 1. Start a resumable upload session.
    const startRes = await fetchWithTimeout(
      `${GEMINI_BASE}/upload/v1beta/files?key=${input.apiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(input.fileSize),
          'X-Goog-Upload-Header-Content-Type': input.mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          file: { display_name: input.displayName ?? 'upload' },
        }),
      },
      TIMEOUT_MS,
      'Gemini upload start',
    );
    if (!startRes.ok) {
      await geminiError('files upload start failed', startRes);
    }
    const uploadUrl = startRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) {
      throw new Error(
        'files upload start failed: missing x-goog-upload-url header',
      );
    }

    // 2. Stream the bytes and finalize in one request (no buffering).
    const uploadInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'Content-Length': String(input.fileSize),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: src.body,
      duplex: 'half',
    };
    const uploadRes = await fetchWithTimeout(
      uploadUrl,
      uploadInit,
      UPLOAD_TIMEOUT_MS,
      'Gemini upload',
    );
    if (!uploadRes.ok) {
      await geminiError('files upload failed', uploadRes);
    }
    let file = ((await uploadRes.json()) as { file: FilesApiFile }).file;

    // 3. Poll until the file is ACTIVE (images are usually instant).
    let attempts = 0;
    while (file.state === 'PROCESSING') {
      if (attempts >= MAX_POLL_ATTEMPTS) {
        throw new Error(
          `files upload still processing after ${attempts} polls`,
        );
      }
      await sleep(POLL_DELAY_MS);
      attempts++;
      const pollRes = await fetchWithTimeout(
        `${GEMINI_BASE}/v1beta/${file.name}?key=${input.apiKey}`,
        {},
        TIMEOUT_MS,
        'Gemini files get',
      );
      if (!pollRes.ok) {
        await geminiError('files get failed', pollRes);
      }
      file = (await pollRes.json()) as FilesApiFile;
    }

    if (file.state !== 'ACTIVE') {
      throw new Error(`files upload failed: state ${file.state}`);
    }

    return {
      fileUri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      state: file.state,
    };
  }
}
