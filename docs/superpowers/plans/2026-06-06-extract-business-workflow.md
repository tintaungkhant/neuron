# Extract Business Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carve the channel-agnostic conversation core out of `telegramWorkflow` into a shared engine sub-workflow (`conversationWorkflow`) plus a shared media helper, so a future `messengerWorkflow` can reuse them — with the Telegram bot behaving exactly as before.

**Architecture:** A new `conversationWorkflow` (engine `WorkflowFn`) owns the AI agent run + memory load + reply stripping; the channel adapter calls it via `wf.runWorkflow`. A new `read-attachment` module owns `planMedia` + the Gemini upload/read sequence. The telegram workflow keeps webhook parse, chat upsert, Telegram file resolution, sending, commit-after-send, and apology.

**Tech Stack:** NestJS 11, TypeScript (nodenext), engine workflow/node model, Jest. Package manager **pnpm**.

**Conventions for the implementer:**
- Run a single spec with `pnpm test -- <pattern>`.
- App code may import from the engine barrel `../../engine`; engine never imports app.
- Tests mock `PgChatMemory` and `../db/client`, and stub `global.fetch` for OpenRouter/Gemini/Telegram — never hit the network or a real DB.
- Several moves are **verbatim cut-paste** of existing constants/functions. Move the exact text; do not retype large blocks (the system prompt especially).

---

## File Structure

- `src/app/media/read-attachment.ts` — `planMedia`, `MediaPlan`, media prompts, `readAttachment(wf, …)`. (create)
- `src/app/media/read-attachment.spec.ts` — unit tests. (create)
- `src/app/conversation/conversation.workflow.ts` — `conversationWorkflow`, `SYSTEM_PROMPT`, tool wiring. (create)
- `src/app/conversation/conversation.workflow.spec.ts` — unit tests. (create)
- `src/app/workflows/telegram.workflow.ts` — slimmed channel adapter. (modify — full rewrite)
- `src/app/workflows/telegram.workflow.spec.ts` — three trace-step assertions updated. (modify)

Source of truth for the verbatim moves is the **current** `src/app/workflows/telegram.workflow.ts`:
- `IMAGE_PROMPT`, `VIDEO_PROMPT`, `AUDIO_PROMPT` constants
- `MediaPlan` interface + `planMedia` function
- the `SYSTEM_PROMPT` constant
- `SORRY_MESSAGE`, `UNSUPPORTED_MESSAGE` (these STAY in telegram.workflow.ts)

---

## Task 1: Shared media helper

**Files:**
- Create: `src/app/media/read-attachment.ts`
- Test: `src/app/media/read-attachment.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/media/read-attachment.spec.ts`:

```ts
import { planMedia, readAttachment } from './read-attachment';
import type { Context } from '../../engine';
import type { NormalizedAttachment } from '../../engine/nodes/telegram/webhook.node';

function att(kind: string): NormalizedAttachment {
  return { kind, fileId: 'f', fileUniqueId: 'u' } as NormalizedAttachment;
}

describe('planMedia', () => {
  it('maps photo to an image plan (not slow)', () => {
    const plan = planMedia(att('photo'));
    expect(plan).toMatchObject({ label: 'an image', mime: 'image/jpeg', slow: false });
  });

  it('maps video/audio/voice to slow plans', () => {
    expect(planMedia(att('video'))).toMatchObject({ label: 'a video', slow: true });
    expect(planMedia(att('audio'))).toMatchObject({ label: 'an audio message', slow: true });
    expect(planMedia(att('voice'))).toMatchObject({ label: 'a voice message', slow: true });
  });

  it('returns null for unsupported kinds', () => {
    expect(planMedia(att('document'))).toBeNull();
    expect(planMedia(att('animation'))).toBeNull();
    expect(planMedia(att('sticker'))).toBeNull();
  });
});

describe('readAttachment', () => {
  it('uploads then reads via the gemini nodes and returns the text', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ fileUri: 'gen://abc' }) // upload
      .mockResolvedValueOnce({ text: 'a bank slip' }); // read
    const wf = { run } as unknown as Context;

    const text = await readAttachment(wf, {
      fileUrl: 'https://tg/file',
      fileSize: 1234,
      plan: { label: 'an image', mime: 'image/jpeg', prompt: 'P', slow: false },
      geminiApiKey: 'KEY',
      geminiModel: 'gemini-x',
    });

    expect(text).toBe('a bank slip');
    expect(run).toHaveBeenCalledTimes(2);
    const uploadArg = run.mock.calls[0][1] as Record<string, unknown>;
    expect(uploadArg).toMatchObject({
      apiKey: 'KEY',
      url: 'https://tg/file',
      mimeType: 'image/jpeg',
      fileSize: 1234,
    });
    const readArg = run.mock.calls[1][1] as Record<string, unknown>;
    expect(readArg).toMatchObject({
      apiKey: 'KEY',
      model: 'gemini-x',
      fileUri: 'gen://abc',
      mimeType: 'image/jpeg',
      prompt: 'P',
    });
  });

  it('applies slow timeouts for slow media', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ fileUri: 'g' })
      .mockResolvedValueOnce({ text: 't' });
    const wf = { run } as unknown as Context;

    await readAttachment(wf, {
      fileUrl: 'u',
      fileSize: 1,
      plan: { label: 'a video', mime: 'video/mp4', prompt: 'P', slow: true },
      geminiApiKey: 'K',
      geminiModel: 'm',
    });

    const uploadArg = run.mock.calls[0][1] as Record<string, unknown>;
    expect(uploadArg).toMatchObject({
      uploadTimeoutMs: 300_000,
      pollIntervalMs: 2_000,
      maxPollAttempts: 60,
    });
    const readArg = run.mock.calls[1][1] as Record<string, unknown>;
    expect(readArg).toMatchObject({ timeoutMs: 120_000 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- read-attachment`
Expected: FAIL — module `./read-attachment` does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/app/media/read-attachment.ts`. Copy the `IMAGE_PROMPT`,
`VIDEO_PROMPT`, `AUDIO_PROMPT` constants and the `MediaPlan` interface +
`planMedia` function **verbatim** from the current `telegram.workflow.ts`, then
add `readAttachment`:

```ts
import {
  GeminiReadMediaNode,
  GeminiUploadFileNode,
  type Context,
} from '../../engine';
import type { NormalizedAttachment } from '../../engine/nodes/telegram/webhook.node';

const IMAGE_PROMPT = `Describe this image for a sales assistant. If it is a payment receipt or bank transfer slip, extract the amount, sender name, date, and reference/transaction number. Otherwise describe what is shown (product, ad, screenshot, etc.) concisely.`;

const VIDEO_PROMPT = `Describe this video for a sales assistant. Summarize what happens, transcribe any speech (keep the speaker's original language), and note on-screen text, products, or anything relevant to a customer inquiry. Be concise.`;

const AUDIO_PROMPT = `Transcribe this audio for a sales assistant, keeping the speaker's original language. Then briefly note anything relevant to their inquiry (service interest, questions, payment). Be concise.`;

export interface MediaPlan {
  label: string; // how the attachment is described to the agent
  mime: string;
  prompt: string;
  slow: boolean; // video/audio need a longer upload + processing window
}

// Maps a normalized attachment to a Gemini read plan, or null for kinds we
// don't process (animation, document, sticker).
export function planMedia(att: NormalizedAttachment): MediaPlan | null {
  switch (att.kind) {
    case 'photo':
      return { label: 'an image', mime: 'image/jpeg', prompt: IMAGE_PROMPT, slow: false };
    case 'video':
      return { label: 'a video', mime: att.mimeType ?? 'video/mp4', prompt: VIDEO_PROMPT, slow: true };
    case 'audio':
      return { label: 'an audio message', mime: att.mimeType ?? 'audio/mpeg', prompt: AUDIO_PROMPT, slow: true };
    case 'voice':
      return { label: 'a voice message', mime: att.mimeType ?? 'audio/ogg', prompt: AUDIO_PROMPT, slow: true };
    default:
      return null;
  }
}

export interface ReadAttachmentParams {
  fileUrl: string;
  fileSize: number;
  plan: MediaPlan;
  geminiApiKey: string;
  geminiModel: string;
}

// Channel-agnostic: given a resolved file URL, upload to the Gemini Files API
// and read it back as text. Slow media (video/audio) gets longer windows.
export async function readAttachment(
  wf: Context,
  params: ReadAttachmentParams,
): Promise<string> {
  const { fileUrl, fileSize, plan, geminiApiKey, geminiModel } = params;
  const uploaded = await wf.run(GeminiUploadFileNode, {
    apiKey: geminiApiKey,
    url: fileUrl,
    mimeType: plan.mime,
    fileSize,
    ...(plan.slow
      ? { uploadTimeoutMs: 300_000, pollIntervalMs: 2_000, maxPollAttempts: 60 }
      : {}),
  });
  const read = await wf.run(GeminiReadMediaNode, {
    apiKey: geminiApiKey,
    model: geminiModel,
    fileUri: uploaded.fileUri,
    mimeType: plan.mime,
    prompt: plan.prompt,
    ...(plan.slow ? { timeoutMs: 120_000 } : {}),
  });
  return read.text;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- read-attachment`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/media/read-attachment.ts src/app/media/read-attachment.spec.ts
git commit -m "feat(app): shared media helper (planMedia + readAttachment)"
```

---

## Task 2: Conversation business sub-workflow

**Files:**
- Create: `src/app/conversation/conversation.workflow.ts`
- Test: `src/app/conversation/conversation.workflow.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/conversation/conversation.workflow.spec.ts`:

```ts
jest.mock('../../engine/nodes/ai/pg-chat-memory', () => ({
  PgChatMemory: jest.fn(),
}));

jest.mock('../db/client', () => ({
  appDb: { select: jest.fn(), insert: jest.fn() },
  closeAppDb: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../engine';
import { conversationWorkflow } from './conversation.workflow';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('conversationWorkflow', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;
  let memory: { load: jest.Mock; append: jest.Mock };
  let replyContent: string;

  beforeEach(async () => {
    replyContent = 'agent reply';
    memory = {
      load: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    (PgChatMemory as unknown as jest.Mock).mockImplementation(() => memory);

    mod = await Test.createTestingModule({ imports: [EngineModule] }).compile();
    engine = mod.get(WorkflowEngine);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      if (urlOf(input).startsWith('https://openrouter.ai/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { role: 'assistant', content: replyContent } }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await mod.close();
  });

  it('runs the agent and returns reply + clean turn; loads but does not append memory', async () => {
    const { result, trace } = await engine.run(conversationWorkflow, {
      sessionId: 'app:1',
      chatExtId: 1,
      text: 'hi',
    });

    expect(result.reply).toBe('agent reply');
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'agent reply' },
    ]);
    expect(PgChatMemory).toHaveBeenCalledWith({ sessionId: 'app:1' });
    expect(memory.load).toHaveBeenCalledWith();
    expect(memory.append).not.toHaveBeenCalled();
    expect(trace.steps.map((s) => s.name)).toEqual(['AiAgentNode']);
  });

  it('strips markdown from the reply', async () => {
    replyContent = '**bold** reply';
    const { result } = await engine.run(conversationWorkflow, {
      sessionId: 'app:1',
      chatExtId: 1,
      text: 'hi',
    });
    expect(result.reply).toBe('bold reply');
  });

  it('sends the Better Solutions prompt and the get_services tool to OpenRouter', async () => {
    await engine.run(conversationWorkflow, { sessionId: 'app:1', chatExtId: 1, text: 'hi' });
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const orCall = calls.find(([u]) => urlOf(u).startsWith('https://openrouter.ai/'));
    const body = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
    expect(body.messages.find((m) => m.role === 'system')?.content).toMatch(/Better Solutions/);
    expect((body.tools ?? []).map((t) => t.function.name)).toContain('get_services');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- conversation.workflow`
Expected: FAIL — module `./conversation.workflow` does not exist.

- [ ] **Step 3: Implement the conversation workflow**

Create `src/app/conversation/conversation.workflow.ts`. Move the `SYSTEM_PROMPT`
constant **verbatim** from the current `telegram.workflow.ts` (the long template
literal). Then:

```ts
import {
  AiAgentNode,
  OpenRouterChatModel,
  PgChatMemory,
  type ChatMessage,
  type WorkflowFn,
} from '../../engine';
import { appConfig } from '../config';
import { stripMarkdown } from '../strip-markdown';
import { CreateOrderTool } from '../tools/create-order.tool';
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

const SYSTEM_PROMPT = `...MOVE VERBATIM FROM telegram.workflow.ts...`;

export interface ConversationInput {
  sessionId: string;
  chatExtId: number;
  text: string;
}

export interface ConversationOutput {
  reply: string; // final plain-text reply (markdown stripped)
  messages: ChatMessage[]; // clean turn to commit to memory after delivery
}

// The channel-agnostic business core: run the sales agent for one turn and
// return its reply plus the clean turn to persist. Does NOT send and does NOT
// append memory — the channel commits after a successful delivery.
export const conversationWorkflow: WorkflowFn<
  ConversationInput,
  ConversationOutput
> = async function conversationWorkflow(input, wf) {
  const memory = new PgChatMemory({ sessionId: input.sessionId });

  const agent = await wf.run(AiAgentNode, {
    input: input.text,
    systemPrompt: SYSTEM_PROMPT,
    chatModel: new OpenRouterChatModel({
      apiKey: appConfig.openRouterApiKey,
      model: appConfig.openRouterModel,
    }),
    memory,
    tools: [
      new GetServicesTool(),
      new GetPaymentMethodsTool(),
      new GetFaqsTool(),
      new CreateOrderTool({ chatExtId: input.chatExtId }),
    ],
  });

  return { reply: stripMarkdown(agent.output), messages: agent.messages };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- conversation.workflow`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/conversation/conversation.workflow.ts src/app/conversation/conversation.workflow.spec.ts
git commit -m "feat(app): channel-agnostic conversation business workflow"
```

---

## Task 3: Slim the telegram channel adapter

**Files:**
- Modify: `src/app/workflows/telegram.workflow.ts` (full rewrite)
- Modify: `src/app/workflows/telegram.workflow.spec.ts` (three assertions)

- [ ] **Step 1: Update the three trace-step assertions in the existing spec**

In `src/app/workflows/telegram.workflow.spec.ts`, replace `'AiAgentNode'` with
`'conversationWorkflow'` in the three `trace.steps.map((s) => s.name)` arrays.

Text-message flow (currently around line 102):

```ts
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'conversationWorkflow',
      'TelegramSendMessageNode',
    ]);
```

Photo flow (currently around line 340) and video flow (currently around line
572) — both become:

```ts
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'TelegramGetFileNode',
      'GeminiUploadFileNode',
      'GeminiReadMediaNode',
      'conversationWorkflow',
      'TelegramSendMessageNode',
    ]);
```

Leave every other assertion unchanged.

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- telegram.workflow`
Expected: FAIL — the workflow still emits a flat `AiAgentNode` step (and still
imports moved symbols), so the updated assertions don't match yet.

- [ ] **Step 3: Rewrite the telegram workflow**

Replace the entire contents of `src/app/workflows/telegram.workflow.ts` with the
following. Keep the `SORRY_MESSAGE` and `UNSUPPORTED_MESSAGE` constants
**verbatim** from the current file (Burmese text):

```ts
import { PgChatMemory, type WorkflowFn } from '../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../engine/nodes/telegram/webhook.node';
import { TelegramGetFileNode } from '../../engine/nodes/telegram/get-file.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';
import { appConfig } from '../config';
import { appDb } from '../db/client';
import { chats } from '../db/schema';
import { planMedia, readAttachment } from '../media/read-attachment';
import { conversationWorkflow } from '../conversation/conversation.workflow';

// Shown to the customer on ANY failure — a fixed, non-technical apology so no
// error detail (DB, API, timeout, …) ever leaks into the chat.
const SORRY_MESSAGE =
  'တောင်းပန်ပါတယ်ရှင် 🙏 System error လေးဖြစ်နေလို့ ခဏနေ Admin မှ စာပြန်ပို့ပေးပါမယ်နော်။';

// Sent when the attachment is a kind we don't read (animation, document, sticker).
const UNSUPPORTED_MESSAGE =
  'ဒီ file အမျိုးအစားကို လောလောဆယ် ဖတ်လို့မရသေးပါဘူးရှင် 🙏 စာသား (သို့) ပုံ၊ အသံ၊ ဗီဒီယို နဲ့ ပြန်ပို့ပေးပါနော်။';

export const telegramWorkflow: WorkflowFn<TelegramWebhookPayload, void> =
  async function telegramWorkflow(payload, wf) {
    const parsed = await wf.run(TelegramWebhookNode, payload);
    if (!parsed) return; // non-message update — nothing to do

    try {
      // Upsert the chat without a pre-select — a unique ext_id + onConflictDoNothing
      // is race-safe. Runs for EVERY message (even no-text / unsupported), so the
      // chat is always registered.
      await appDb
        .insert(chats)
        .values({
          extId: parsed.chat.id,
          name: parsed.from?.username ?? parsed.from?.firstName ?? null,
        })
        .onConflictDoNothing({ target: chats.extId });

      let agentText: string;
      const attachment = parsed.attachment;
      if (attachment) {
        const plan = planMedia(attachment);
        if (!plan) {
          // animation / document / sticker — not something we read
          await wf.run(TelegramSendMessageNode, {
            botToken: appConfig.telegramBotToken,
            chatId: parsed.chat.id,
            text: UNSUPPORTED_MESSAGE,
          });
          return;
        }

        const file = await wf.run(TelegramGetFileNode, {
          botToken: appConfig.telegramBotToken,
          fileId: attachment.fileId,
        });
        const fileSize = file.fileSize ?? attachment.fileSize;
        if (fileSize == null) {
          throw new Error('cannot determine media file size');
        }
        const text = await readAttachment(wf, {
          fileUrl: file.url,
          fileSize,
          plan,
          geminiApiKey: appConfig.geminiApiKey,
          geminiModel: appConfig.geminiModel,
        });
        const caption = parsed.text;
        agentText =
          `[User sent ${plan.label}. Contents: ${text}]` +
          (caption ? `\n${caption}` : '');
      } else {
        if (!parsed.text) return;
        agentText = parsed.text;
      }

      const sessionId = `${appConfig.id}:${parsed.chat.id}`;
      const result = await wf.runWorkflow(conversationWorkflow, {
        sessionId,
        chatExtId: parsed.chat.id,
        text: agentText,
      });

      await wf.run(TelegramSendMessageNode, {
        botToken: appConfig.telegramBotToken,
        chatId: parsed.chat.id,
        text: result.reply,
      });

      // Commit the turn to memory ONLY after the reply was delivered, so a
      // failed send never poisons history with a message the user didn't see.
      await new PgChatMemory({ sessionId }).append(result.messages);
    } catch (err) {
      // Catch-all: apologize to the customer, then rethrow so the failure is
      // still recorded in the trace / executions.
      try {
        await wf.run(TelegramSendMessageNode, {
          botToken: appConfig.telegramBotToken,
          chatId: parsed.chat.id,
          text: SORRY_MESSAGE,
        });
      } catch {
        // ignore — nothing more we can do for the user
      }
      throw err;
    }
  };
```

- [ ] **Step 4: Run the telegram spec to verify it passes**

Run: `pnpm test -- telegram.workflow`
Expected: PASS (all existing scenarios green with the three updated assertions).

- [ ] **Step 5: Commit**

```bash
git add src/app/workflows/telegram.workflow.ts src/app/workflows/telegram.workflow.spec.ts
git commit -m "refactor(app): telegram workflow delegates to conversation + media helper"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS (new media + conversation specs, updated telegram spec, everything else).

- [ ] **Lint**

Run: `pnpm lint`
Expected: clean (lint auto-fixes; re-stage and amend the last commit if it modifies files).

- [ ] **Build**

Run: `pnpm build`
Expected: succeeds — confirms the slimmed imports and new modules type-check.
