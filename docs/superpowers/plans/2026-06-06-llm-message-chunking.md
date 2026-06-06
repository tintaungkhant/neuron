# LLM Message Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver long agent replies as several natural chat messages by adding an LLM `ChunkMessageNode`, which the Telegram workflow invokes when a reply exceeds a threshold, then sends each chunk in order.

**Architecture:** A new generic engine node `ChunkMessageNode` asks a `ChatModel` to split text into a JSON array of messages, falling back to `[text]` on any parse failure. The Telegram channel workflow checks reply length against a local `CHUNK_THRESHOLD`, runs the node (with a fresh `OpenRouterChatModel`) when over, and loops the resulting chunks through `TelegramSendMessageNode`; if the node call throws, it sends the whole reply.

**Tech Stack:** NestJS 11, engine workflow/node model, `ChatModel` port over OpenRouter, Jest. Package manager **pnpm**.

**Conventions for the implementer:**
- Run a single spec with `pnpm test -- <pattern>`.
- Engine nodes are DI providers: register new ones in `EngineModule` (providers + exports), or `wf.run` can't resolve them.
- The node spec constructs the node directly with a fake `ChatModel` — no DI, no network.
- The telegram spec stubs `global.fetch`; OpenRouter calls are distinguished by request body (agent body contains "Better Solutions"; chunk body contains "JSON array of strings").

---

## File Structure

- `src/engine/nodes/ai/chunk-message.node.ts` — `ChunkMessageNode` + IO types. (create)
- `src/engine/nodes/ai/chunk-message.node.spec.ts` — node unit tests. (create)
- `src/engine/engine.module.ts` — register `ChunkMessageNode`. (modify)
- `src/engine/index.ts` — export `ChunkMessageNode` + types. (modify)
- `src/app/workflows/telegram.workflow.ts` — threshold + chunk + send loop. (modify)
- `src/app/workflows/telegram.workflow.spec.ts` — add long-reply chunk tests. (modify)

---

## Task 1: ChunkMessageNode (engine)

**Files:**
- Create: `src/engine/nodes/ai/chunk-message.node.ts`
- Test: `src/engine/nodes/ai/chunk-message.node.spec.ts`
- Modify: `src/engine/engine.module.ts`
- Modify: `src/engine/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/nodes/ai/chunk-message.node.spec.ts`:

```ts
import { ChunkMessageNode } from './chunk-message.node';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatModel,
} from '../../ai/chat-model';

class FakeChatModel implements ChatModel {
  readonly calls: ChatCompletionRequest[] = [];
  constructor(private readonly content: string) {}
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(req);
    return Promise.resolve({
      message: { role: 'assistant', content: this.content },
    });
  }
}

describe('ChunkMessageNode', () => {
  it('returns the parsed JSON array of strings', async () => {
    const model = new FakeChatModel('["one", "two", "three"]');
    const out = await new ChunkMessageNode().execute({
      text: 'long text',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['one', 'two', 'three']);
  });

  it('extracts the array from surrounding prose / code fences', async () => {
    const model = new FakeChatModel('Sure:\n```json\n["a", "b"]\n```');
    const out = await new ChunkMessageNode().execute({
      text: 't',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['a', 'b']);
  });

  it('falls back to [text] when the content is not JSON', async () => {
    const model = new FakeChatModel('I cannot do that');
    const out = await new ChunkMessageNode().execute({
      text: 'original',
      chatModel: model,
    });
    expect(out.chunks).toEqual(['original']);
  });

  it('falls back to [text] for an empty array or non-string items', async () => {
    expect(
      (
        await new ChunkMessageNode().execute({
          text: 'original',
          chatModel: new FakeChatModel('[]'),
        })
      ).chunks,
    ).toEqual(['original']);
    expect(
      (
        await new ChunkMessageNode().execute({
          text: 'original',
          chatModel: new FakeChatModel('[1, 2]'),
        })
      ).chunks,
    ).toEqual(['original']);
  });

  it('includes maxChars and the input text in the prompt', async () => {
    const model = new FakeChatModel('["x"]');
    await new ChunkMessageNode().execute({
      text: 'HELLO-TEXT',
      chatModel: model,
      maxChars: 1234,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).toContain('1234');
    expect(sent).toContain('HELLO-TEXT');
  });

  it('defaults maxChars to 4096 when not given', async () => {
    const model = new FakeChatModel('["x"]');
    await new ChunkMessageNode().execute({ text: 't', chatModel: model });
    expect(model.calls[0].messages[0].content).toContain('4096');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- chunk-message.node`
Expected: FAIL — module `./chunk-message.node` does not exist.

- [ ] **Step 3: Implement the node**

Create `src/engine/nodes/ai/chunk-message.node.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- chunk-message.node`
Expected: PASS (6 tests).

- [ ] **Step 5: Register the node in EngineModule**

In `src/engine/engine.module.ts`, add the import and include `ChunkMessageNode`
in BOTH `providers` and `exports` (alongside `AiAgentNode`):

```ts
import { ChunkMessageNode } from './nodes/ai/chunk-message.node';
```

```ts
  providers: [
    WorkflowEngine,
    AiAgentNode,
    ChunkMessageNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadMediaNode,
    ExecutionStore,
    DbShutdown,
  ],
  exports: [
    WorkflowEngine,
    AiAgentNode,
    ChunkMessageNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadMediaNode,
    ExecutionStore,
  ],
```

- [ ] **Step 6: Export the node from the engine barrel**

In `src/engine/index.ts`, after the `AiAgentNode` exports, add:

```ts
export { ChunkMessageNode } from './nodes/ai/chunk-message.node';
export type {
  ChunkMessageInput,
  ChunkMessageOutput,
} from './nodes/ai/chunk-message.node';
```

- [ ] **Step 7: Verify the build + node tests**

Run: `pnpm build && pnpm test -- chunk-message.node`
Expected: build succeeds; 6 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/nodes/ai/chunk-message.node.ts src/engine/nodes/ai/chunk-message.node.spec.ts src/engine/engine.module.ts src/engine/index.ts
git commit -m "feat(engine): ChunkMessageNode splits long replies via the chat model"
```

---

## Task 2: Telegram workflow chunk + send loop

**Files:**
- Modify: `src/app/workflows/telegram.workflow.ts`
- Test: `src/app/workflows/telegram.workflow.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `src/app/workflows/telegram.workflow.spec.ts`, add two tests inside the
top-level `describe('telegramWorkflow', …)` block. They override the default
`fetch` stub so the agent returns a long reply and the chunk call returns an
array (distinguished by request body):

```ts
  it('chunks a long reply and sends each piece in order', async () => {
    const longReply = 'x'.repeat(600); // > CHUNK_THRESHOLD (500)
    fetchSpy.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url.startsWith('https://openrouter.ai/')) {
          const body = (init?.body as string) ?? '';
          const content = body.includes('Better Solutions')
            ? longReply // the agent turn
            : '["part one","part two"]'; // the chunk turn
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [{ message: { role: 'assistant', content } }],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      },
    );

    const payload: TelegramWebhookPayload = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'tell me everything',
      },
    };

    await engine.run(telegramWorkflow, payload);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const tgTexts = calls
      .filter(([u]) => urlOf(u).includes('api.telegram.org'))
      .map(([, i]) => (JSON.parse(i.body as string) as { text: string }).text);
    expect(tgTexts).toEqual(['part one', 'part two']);
  });

  it('sends the whole reply when the chunk call fails', async () => {
    const longReply = 'y'.repeat(600);
    fetchSpy.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (url.startsWith('https://openrouter.ai/')) {
          const body = (init?.body as string) ?? '';
          if (body.includes('Better Solutions')) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  choices: [
                    { message: { role: 'assistant', content: longReply } },
                  ],
                }),
                { status: 200 },
              ),
            );
          }
          // chunk call fails
          return Promise.resolve(new Response('boom', { status: 500 }));
        }
        return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
      },
    );

    const payload: TelegramWebhookPayload = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'tell me everything',
      },
    };

    await engine.run(telegramWorkflow, payload);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const tgTexts = calls
      .filter(([u]) => urlOf(u).includes('api.telegram.org'))
      .map(([, i]) => (JSON.parse(i.body as string) as { text: string }).text);
    expect(tgTexts).toEqual([longReply]); // single whole-reply send
  });
```

- [ ] **Step 2: Run the spec to verify the new tests fail**

Run: `pnpm test -- telegram.workflow`
Expected: the two new tests FAIL — the workflow currently sends `result.reply`
once regardless of length (the long-reply test expects two sends).

- [ ] **Step 3: Add the threshold + chunk + loop to the workflow**

In `src/app/workflows/telegram.workflow.ts`:

Update the engine import to add `OpenRouterChatModel` and `ChunkMessageNode`:

```ts
import {
  ChunkMessageNode,
  OpenRouterChatModel,
  PgChatMemory,
  type WorkflowFn,
} from '../../engine';
```

Add the threshold constant next to the message constants:

```ts
const CHUNK_THRESHOLD = 500; // replies longer than this get AI-chunked
```

Replace the single reply send (the `await wf.run(TelegramSendMessageNode, { …, text: result.reply })`)
and keep the memory append after it. The relevant block becomes:

```ts
      const sessionId = `${appConfig.id}:${parsed.chat.id}`;
      const result = await wf.runWorkflow(conversationWorkflow, {
        sessionId,
        chatExtId: parsed.chat.id,
        text: agentText,
      });

      let chunks = [result.reply];
      if (result.reply.length > CHUNK_THRESHOLD) {
        try {
          const chunked = await wf.run(ChunkMessageNode, {
            text: result.reply,
            chatModel: new OpenRouterChatModel({
              apiKey: appConfig.openRouterApiKey,
              model: appConfig.openRouterModel,
            }),
            maxChars: 4096,
          });
          if (chunked.chunks.length) chunks = chunked.chunks;
        } catch {
          // fallback: send the whole reply as one message
        }
      }

      for (const chunk of chunks) {
        await wf.run(TelegramSendMessageNode, {
          botToken: appConfig.telegramBotToken,
          chatId: parsed.chat.id,
          text: chunk,
        });
      }

      // Commit the turn to memory ONLY after the reply was delivered, so a
      // failed send never poisons history with a message the user didn't see.
      await new PgChatMemory({ sessionId }).append(result.messages);
```

- [ ] **Step 4: Run the telegram spec to verify it passes**

Run: `pnpm test -- telegram.workflow`
Expected: PASS — the two new tests plus all existing ones (short replies still
send once; the long-reply path now chunks; failure falls back to the whole
reply).

- [ ] **Step 5: Commit**

```bash
git add src/app/workflows/telegram.workflow.ts src/app/workflows/telegram.workflow.spec.ts
git commit -m "feat(app): chunk long telegram replies via ChunkMessageNode"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS.

- [ ] **Lint**

Run: `pnpm lint`
Expected: clean (lint auto-fixes; re-stage if it modifies files).

- [ ] **Build**

Run: `pnpm build`
Expected: succeeds.
