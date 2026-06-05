# Gemini Image Reader Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three built-in engine nodes that turn a Telegram image into text via the native Gemini Files API, streaming large files instead of buffering them.

**Architecture:** `TelegramGetFileNode` resolves a Telegram `fileId` to a downloadable URL. `GeminiUploadFileNode` streams that URL straight into the Gemini Files API (resumable upload, no full buffer) and returns a `file_uri`. `GeminiReadImageNode` calls `generateContent` with the `file_uri` + a caller prompt and returns the text. No demo wiring, no agent-input change, no S3 (deferred).

**Tech Stack:** NestJS 11, TypeScript (nodenext/CommonJS), Jest (mock global `fetch`), native `fetch` streaming with `duplex: 'half'`.

Spec: `docs/superpowers/specs/2026-06-05-gemini-image-reader-node-design.md`

---

## File Structure

- Create `src/engine/nodes/gemini/gemini-http.ts` — shared base URL, error helper, `sleep`.
- Create `src/engine/nodes/telegram/get-file.node.ts` (+ `.spec.ts`) — fileId → URL.
- Create `src/engine/nodes/gemini/upload-file.node.ts` (+ `.spec.ts`) — stream URL → Files API.
- Create `src/engine/nodes/gemini/read-image.node.ts` (+ `.spec.ts`) — file_uri → text.
- Modify `src/engine/engine.module.ts` — register the 3 nodes.
- Modify `src/engine/index.ts` — export the 3 node classes + their I/O types.

---

## Task 1: Shared Gemini HTTP helper

**Files:**
- Create: `src/engine/nodes/gemini/gemini-http.ts`

This is thin plumbing (constant + two helpers) exercised by the node specs in later tasks — no dedicated spec.

- [ ] **Step 1: Create the helper file**

```typescript
// src/engine/nodes/gemini/gemini-http.ts
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

/** Throw a uniform Error from a failed Gemini/Files API Response. */
export async function geminiError(
  context: string,
  res: Response,
): Promise<never> {
  const body = await res.text();
  throw new Error(`${context}: ${res.status} ${body}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: builds clean (no usages yet, just verifies the file compiles).

- [ ] **Step 3: Commit**

```bash
git add src/engine/nodes/gemini/gemini-http.ts
git commit -m "feat(engine): add shared gemini http helper"
```

---

## Task 2: TelegramGetFileNode

**Files:**
- Create: `src/engine/nodes/telegram/get-file.node.ts`
- Test: `src/engine/nodes/telegram/get-file.node.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/nodes/telegram/get-file.node.spec.ts
import { TelegramGetFileNode } from './get-file.node';

describe('TelegramGetFileNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('calls getFile and builds the download URL', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { file_path: 'photos/file_1.jpg', file_size: 1234 },
        }),
        { status: 200 },
      ),
    );
    const node = new TelegramGetFileNode();
    const out = await node.execute({ botToken: 'abc', fileId: 'XYZ' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.telegram.org/botabc/getFile?file_id=XYZ');
    expect(out).toEqual({
      url: 'https://api.telegram.org/file/botabc/photos/file_1.jpg',
      filePath: 'photos/file_1.jpg',
      fileSize: 1234,
    });
  });

  it('throws when getFile returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
    const node = new TelegramGetFileNode();
    await expect(
      node.execute({ botToken: 't', fileId: 'f' }),
    ).rejects.toThrow(/getFile failed: 404 nope/);
  });

  it('throws when response has no file_path', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    const node = new TelegramGetFileNode();
    await expect(
      node.execute({ botToken: 't', fileId: 'f' }),
    ).rejects.toThrow(/no file_path/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- get-file.node`
Expected: FAIL — `Cannot find module './get-file.node'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/engine/nodes/telegram/get-file.node.ts
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
  async execute(
    input: TelegramGetFileInput,
  ): Promise<TelegramGetFileOutput> {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- get-file.node`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/telegram/get-file.node.ts src/engine/nodes/telegram/get-file.node.spec.ts
git commit -m "feat(engine): add TelegramGetFileNode"
```

---

## Task 3: GeminiUploadFileNode

**Files:**
- Create: `src/engine/nodes/gemini/upload-file.node.ts`
- Test: `src/engine/nodes/gemini/upload-file.node.spec.ts`

The `sleep` poll delay is mocked in the spec so the poll loop runs instantly.

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/nodes/gemini/upload-file.node.spec.ts
jest.mock('./gemini-http', () => ({
  ...jest.requireActual('./gemini-http'),
  sleep: jest.fn().mockResolvedValue(undefined),
}));

import { GeminiUploadFileNode } from './upload-file.node';

describe('GeminiUploadFileNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const file = {
    name: 'files/abc',
    uri: 'https://gen.googleapis.com/files/abc',
    mimeType: 'image/jpeg',
    state: 'ACTIVE',
  };

  it('streams the source through a resumable upload and returns the file_uri', async () => {
    const srcResponse = new Response('image-bytes', { status: 200 });
    const srcBody = srcResponse.body;
    fetchSpy
      .mockResolvedValueOnce(srcResponse) // source fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      ) // start
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file }), { status: 200 }),
      ); // upload+finalize

    const node = new GeminiUploadFileNode();
    const out = await node.execute({
      apiKey: 'KEY',
      url: 'https://api.telegram.org/file/bott/photos/x.jpg',
      mimeType: 'image/jpeg',
      fileSize: 11,
      displayName: 'tg-photo',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // start request
    const [startUrl, startInit] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(startUrl).toBe(
      'https://generativelanguage.googleapis.com/upload/v1beta/files?key=KEY',
    );
    expect(startInit.headers).toMatchObject({
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': '11',
      'X-Goog-Upload-Header-Content-Type': 'image/jpeg',
    });
    expect(JSON.parse(startInit.body as string)).toEqual({
      file: { display_name: 'tg-photo' },
    });

    // upload+finalize request streams the source body
    const [uploadUrl, uploadInit] = fetchSpy.mock.calls[2] as [
      string,
      RequestInit & { duplex?: string },
    ];
    expect(uploadUrl).toBe('https://upload.example/u1');
    expect(uploadInit.headers).toMatchObject({
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    });
    expect(uploadInit.duplex).toBe('half');
    expect(uploadInit.body).toBe(srcBody); // streamed, not buffered

    expect(out).toEqual({
      fileUri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      state: 'ACTIVE',
    });
  });

  it('polls while PROCESSING until ACTIVE', async () => {
    const srcResponse = new Response('bytes', { status: 200 });
    fetchSpy
      .mockResolvedValueOnce(srcResponse) // source
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      ) // start
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { ...file, state: 'PROCESSING' } }), {
          status: 200,
        }),
      ) // upload → PROCESSING
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...file, state: 'ACTIVE' }), {
          status: 200,
        }),
      ); // poll → ACTIVE

    const node = new GeminiUploadFileNode();
    const out = await node.execute({
      apiKey: 'KEY',
      url: 'https://src/x.jpg',
      mimeType: 'image/jpeg',
      fileSize: 5,
    });

    const [pollUrl] = fetchSpy.mock.calls[3] as [string];
    expect(pollUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/files/abc?key=KEY',
    );
    expect(out.state).toBe('ACTIVE');
  });

  it('throws when the source fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/source fetch failed: 404 gone/);
  });

  it('throws when start is missing the upload URL header', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/missing x-goog-upload-url/);
  });

  it('throws when the final state is FAILED', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { ...file, state: 'FAILED' } }), {
          status: 200,
        }),
      );
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/state FAILED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- upload-file.node`
Expected: FAIL — `Cannot find module './upload-file.node'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/engine/nodes/gemini/upload-file.node.ts
import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import { GEMINI_BASE, geminiError, sleep } from './gemini-http';

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
  async execute(
    input: GeminiUploadFileInput,
  ): Promise<GeminiUploadFileOutput> {
    const src = await fetch(input.url);
    if (!src.ok || !src.body) {
      await geminiError('upload source fetch failed', src);
    }

    // 1. Start a resumable upload session.
    const startRes = await fetch(
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
    const uploadRes = await fetch(uploadUrl, uploadInit);
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
      const pollRes = await fetch(
        `${GEMINI_BASE}/v1beta/${file.name}?key=${input.apiKey}`,
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
```

Note: `geminiError` returns `Promise<never>` (always throws), so the lines after the `!ok` guards are unreachable when it fires — TypeScript still narrows correctly because each guard precedes use.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- upload-file.node`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/gemini/upload-file.node.ts src/engine/nodes/gemini/upload-file.node.spec.ts
git commit -m "feat(engine): add GeminiUploadFileNode (streamed Files API upload)"
```

---

## Task 4: GeminiReadImageNode

**Files:**
- Create: `src/engine/nodes/gemini/read-image.node.ts`
- Test: `src/engine/nodes/gemini/read-image.node.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/nodes/gemini/read-image.node.spec.ts
import { GeminiReadImageNode } from './read-image.node';

describe('GeminiReadImageNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs generateContent with file_data + text parts and returns joined text', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'a bank ' }, { text: 'slip' }] } },
          ],
        }),
        { status: 200 },
      ),
    );
    const node = new GeminiReadImageNode();
    const out = await node.execute({
      apiKey: 'KEY',
      model: 'gemini-2.0-flash',
      fileUri: 'https://gen/files/abc',
      mimeType: 'image/jpeg',
      prompt: 'Describe the payment slip',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=KEY',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [
        {
          parts: [
            {
              file_data: {
                mime_type: 'image/jpeg',
                file_uri: 'https://gen/files/abc',
              },
            },
            { text: 'Describe the payment slip' },
          ],
        },
      ],
    });
    expect(out).toEqual({ text: 'a bank slip' });
  });

  it('throws when generateContent returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('bad', { status: 400 }));
    const node = new GeminiReadImageNode();
    await expect(
      node.execute({
        apiKey: 'K',
        model: 'm',
        fileUri: 'u',
        mimeType: 'image/jpeg',
        prompt: 'p',
      }),
    ).rejects.toThrow(/generateContent failed: 400 bad/);
  });

  it('throws when there is no candidate text (e.g. safety block)', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    const node = new GeminiReadImageNode();
    await expect(
      node.execute({
        apiKey: 'K',
        model: 'm',
        fileUri: 'u',
        mimeType: 'image/jpeg',
        prompt: 'p',
      }),
    ).rejects.toThrow(/no text/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- read-image.node`
Expected: FAIL — `Cannot find module './read-image.node'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/engine/nodes/gemini/read-image.node.ts
import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import { GEMINI_BASE, geminiError } from './gemini-http';

export interface GeminiReadImageInput {
  apiKey: string;
  model: string;
  fileUri: string;
  mimeType: string;
  prompt: string;
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
  async execute(
    input: GeminiReadImageInput,
  ): Promise<GeminiReadImageOutput> {
    const res = await fetch(
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- read-image.node`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/gemini/read-image.node.ts src/engine/nodes/gemini/read-image.node.spec.ts
git commit -m "feat(engine): add GeminiReadImageNode"
```

---

## Task 5: Register nodes and export from the engine barrel

**Files:**
- Modify: `src/engine/engine.module.ts`
- Modify: `src/engine/index.ts`

- [ ] **Step 1: Register the nodes in EngineModule**

Replace the contents of `src/engine/engine.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { TelegramGetFileNode } from './nodes/telegram/get-file.node';
import { GeminiUploadFileNode } from './nodes/gemini/upload-file.node';
import { GeminiReadImageNode } from './nodes/gemini/read-image.node';
import { DbShutdown } from './db/db-shutdown';

@Module({
  providers: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
    DbShutdown,
  ],
  exports: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
  ],
})
export class EngineModule {}
```

- [ ] **Step 2: Export node classes + types from the barrel**

Append to `src/engine/index.ts` (after the existing `PgChatMemory` exports, before the `ChatRole` type block — placement is not load-bearing):

```typescript
export { TelegramGetFileNode } from './nodes/telegram/get-file.node';
export type {
  TelegramGetFileInput,
  TelegramGetFileOutput,
} from './nodes/telegram/get-file.node';
export { GeminiUploadFileNode } from './nodes/gemini/upload-file.node';
export type {
  GeminiUploadFileInput,
  GeminiUploadFileOutput,
} from './nodes/gemini/upload-file.node';
export { GeminiReadImageNode } from './nodes/gemini/read-image.node';
export type {
  GeminiReadImageInput,
  GeminiReadImageOutput,
} from './nodes/gemini/read-image.node';
```

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all existing specs plus the 11 new tests (3 + 5 + 3).

- [ ] **Step 4: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: builds clean; lint passes (lint auto-fixes formatting).

- [ ] **Step 5: Commit**

```bash
git add src/engine/engine.module.ts src/engine/index.ts
git commit -m "feat(engine): register and export gemini + telegram getfile nodes"
```

---

## Self-Review Notes

- **Spec coverage:** All three nodes (TelegramGetFileNode, GeminiUploadFileNode, GeminiReadImageNode) + the `gemini-http.ts` helper + EngineModule registration + barrel exports are covered (Tasks 1–5). Streaming requirement enforced by the `uploadInit.body === srcBody` + `duplex === 'half'` assertions in Task 3. Out-of-scope items (S3, demo wiring, agent-input change, `demoConfig` keys) are intentionally absent.
- **Type consistency:** I/O type names are identical across implementation, exports, and EngineModule (`TelegramGetFileInput/Output`, `GeminiUploadFileInput/Output`, `GeminiReadImageInput/Output`). Helper names (`GEMINI_BASE`, `geminiError`, `sleep`) match across all consumers.
- **`duplex` typing:** `RequestInit` in lib.dom does not declare `duplex`; the impl uses an intersection type `RequestInit & { duplex: 'half' }` and the test casts to `RequestInit & { duplex?: string }` — both compile under nodenext.
