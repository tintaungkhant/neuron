# Extract Business Workflow Design

**Date:** 2026-06-06
**Status:** Approved

## Problem

The app will soon serve two channels — Telegram and (later) Facebook Messenger.
Today all logic lives in one `telegramWorkflow`: webhook parsing, file
resolution, Gemini media reading, the AI agent (system prompt + tools + memory),
sending, and the commit-after-send / apology invariants. The conversational
business logic (the agent, prompt, tools, memory) is channel-agnostic and must
be shared; only the I/O edges differ per channel.

## Goal

Carve the channel-agnostic business core out of `telegramWorkflow` into a shared
engine **sub-workflow** that any channel adapter can call, plus a shared media
helper. After this change the Telegram workflow behaves exactly as before, but
its business core is reusable by a future `messengerWorkflow`.

The messenger workflow itself is **out of scope** — this change only creates the
seam.

## Seam (decided)

- **Shared business** owns: AI agent run (system prompt, chat model, tools),
  memory **load**, markdown stripping of the reply.
- **Channel adapter** owns: webhook parsing, **chat upsert** (channel-specific
  identity: extId + name; must register the chat even for no-text / unsupported
  messages — an existing tested behavior), media→text (file URL resolution +
  Gemini read), sending, memory **commit-after-send**, and the failure apology.
- Business signature: `(sessionId, chatExtId, text) → { reply, messages }`.

Note: chat upsert was originally slated for the business core, but it must run
even when no conversation happens (no-text / unsupported-media messages still
register the chat), and extId/name are channel-specific. So it stays in the
channel adapter.

## Components

### 1. Conversation sub-workflow — `src/app/conversation/conversation.workflow.ts` (new)

```ts
export interface ConversationInput {
  sessionId: string;
  chatExtId: number;
  text: string;
}

export interface ConversationOutput {
  reply: string;          // final plain-text reply (markdown already stripped)
  messages: ChatMessage[]; // clean turn to commit to memory after delivery
}

export const conversationWorkflow: WorkflowFn<ConversationInput, ConversationOutput>;
```

Behavior (no chat upsert — that stays in the channel):

1. `const memory = new PgChatMemory({ sessionId })` — used by the agent to LOAD
   history. The sub-workflow does NOT append.
2. `const agent = await wf.run(AiAgentNode, { input: text, systemPrompt:
   SYSTEM_PROMPT, chatModel: new OpenRouterChatModel({ apiKey:
   appConfig.openRouterApiKey, model: appConfig.openRouterModel }), memory,
   tools: [ new GetServicesTool(), new GetPaymentMethodsTool(), new
   GetFaqsTool(), new CreateOrderTool({ chatExtId }) ] })`.
3. `return { reply: stripMarkdown(agent.output), messages: agent.messages }`.

`SYSTEM_PROMPT` and the tool construction move here from
`telegram.workflow.ts`. The strip-markdown step moves here too (business
produces the final plain-text reply).

### 2. Shared media helper — `src/app/media/read-attachment.ts` (new)

Moves `MediaPlan`, `planMedia`, and the `IMAGE_PROMPT` / `VIDEO_PROMPT` /
`AUDIO_PROMPT` constants out of `telegram.workflow.ts`.

```ts
export interface MediaPlan { label: string; mime: string; prompt: string; slow: boolean; }
export function planMedia(att: NormalizedAttachment): MediaPlan | null;

export interface ReadAttachmentParams {
  fileUrl: string;
  fileSize: number;
  plan: MediaPlan;
  geminiApiKey: string;
  geminiModel: string;
}
export function readAttachment(wf: Context, params: ReadAttachmentParams): Promise<string>;
```

`readAttachment` runs `wf.run(GeminiUploadFileNode, …)` then
`wf.run(GeminiReadMediaNode, …)` and returns the read text. It applies the
slow-media timeouts (`uploadTimeoutMs`/`pollIntervalMs`/`maxPollAttempts` on
upload; `timeoutMs` on read) when `plan.slow` is true — same values as today.
It takes an already-resolved `fileUrl`, so it is channel-agnostic; resolving a
Telegram `file_id` to a URL stays in the channel.

`Context` is the engine workflow handle type (`import type { Context } from
'../../engine'`). It is already exported from the engine index, alongside
`WorkflowFn` and `ChatMessage` — no engine changes needed.

### 3. Telegram channel adapter — `src/app/workflows/telegram.workflow.ts` (slimmed)

```
parse webhook (TelegramWebhookNode) → null guard
try:
  upsert chat (extId: chat.id, name: from.username ?? from.firstName ?? null)  // BEFORE the checks below
  if attachment:
    plan = planMedia(attachment)
    if !plan: send UNSUPPORTED_MESSAGE; return
    file = wf.run(TelegramGetFileNode, { botToken, fileId })
    fileSize = file.fileSize ?? attachment.fileSize  (throw if null)
    text = readAttachment(wf, { fileUrl: file.url, fileSize, plan, geminiApiKey, geminiModel })
    agentText = `[User sent ${plan.label}. Contents: ${text}]` + (caption ? `\n${caption}` : '')
  else:
    if !parsed.text: return
    agentText = parsed.text

  sessionId = `${appConfig.id}:${chat.id}`
  result = await wf.runWorkflow(conversationWorkflow, { sessionId, chatExtId: chat.id, text: agentText })
  send result.reply (TelegramSendMessageNode)
  new PgChatMemory({ sessionId }).append(result.messages)   // commit AFTER send
catch: send SORRY_MESSAGE; rethrow
```

Imports removed from this file: `stripMarkdown`, `SYSTEM_PROMPT`, the four
tools, `OpenRouterChatModel`, the media prompts. It keeps: `TelegramWebhookNode`,
`TelegramGetFileNode`, `TelegramSendMessageNode`, `appConfig`, `appDb` + `chats`
(chat upsert stays here), `PgChatMemory` (for the post-send append),
`SORRY_MESSAGE`, `UNSUPPORTED_MESSAGE`, and now `planMedia`/`readAttachment` from
the media helper + `conversationWorkflow`. The Gemini nodes are no longer
imported directly (the helper runs them).

## Trace & tokens

`conversationWorkflow` runs as a sub-workflow, so the trace nests:
`telegram webhook → gemini upload → gemini read → conversationWorkflow{ ai agent
} → telegram send message`. `sumTokens` already recurses into sub-workflows, so
agent token usage still rolls up into the channel workflow total.

## Memory note

Two `PgChatMemory` instances per turn: one in the business workflow (load), one
in the channel after send (append). Both are stateless handles keyed by the same
`sessionId`, so this is safe; it keeps the commit-after-send invariant in the
channel per the chosen seam.

## Testing

- **`src/app/conversation/conversation.workflow.spec.ts`** (new): run
  `conversationWorkflow` via `engine.run`; assert the agent runs, the reply is
  markdown-stripped, `messages` is the clean turn, memory is loaded but NOT
  appended, and the only trace step is `AiAgentNode`. Reuse the existing mocking
  style (mock `PgChatMemory`, mock `appDb`, stub `fetch` for OpenRouter).
- **`src/app/media/read-attachment.spec.ts`** (new): `planMedia` returns the
  right plan per kind (photo/video/audio/voice) and `null` for unsupported
  kinds; `readAttachment` calls both Gemini nodes (stub `fetch`) and returns the
  joined text.
- **`src/app/workflows/telegram.workflow.spec.ts`** (updated): the existing
  end-to-end scenarios still pass through the new internals — webhook→reply,
  media→text, chat upsert (still channel-side), commit-after-send, unsupported
  media, apology on failure. The ONLY assertion changes: three
  `trace.steps.map(s => s.name)` checks where the flat `'AiAgentNode'` step
  becomes `'conversationWorkflow'` (the agent now nests inside it). All upsert,
  sessionId, memory, unsupported, and apology assertions are unchanged.

No live testing — the user verifies the running bot.

## Out of scope

- The `messengerWorkflow` and any Messenger-specific nodes.
- A shared module for the apology / unsupported text (stays channel-side).
- Any change to the agent, tools, memory, or engine internals.
