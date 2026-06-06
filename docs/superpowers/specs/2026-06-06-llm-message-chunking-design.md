# LLM Message Chunking Design

**Date:** 2026-06-06
**Status:** Approved

## Problem

The agent sometimes produces a genuinely long reply (real content that cannot be
shortened — e.g. a service description + requirements + closing). Sent as one
Telegram message it reads as a wall of text, and a reply over Telegram's 4096
character cap is rejected outright. We want long replies delivered as several
shorter chat messages, broken at **natural, semantic** boundaries (intro /
requirements / closing) — decided by the model's understanding, not by
punctuation rules or fixed character counts.

## Approach (decided)

Hybrid where the **brain** does the splitting:

1. Code checks the reply length.
2. If it exceeds a threshold, hand the full reply to a dedicated LLM **chunk
   node** that returns an array of natural messages.
3. Code loops the array and sends each message in order.

Rejected alternatives: deterministic punctuation splitting (not semantic enough),
and model-emitted split markers in the main reply (pollutes the reply, model may
ignore).

## Decisions

- **Threshold lives in the trigger flow** — a constant in the channel workflow
  (`telegram.workflow.ts`), not an env var. Default `CHUNK_THRESHOLD = 500`.
- **Fallback = send the whole reply** if the chunk node fails (bad/unparseable
  output or a model/network error). No deterministic code splitter.
- **No content-preservation verification** — trust the model. (Accepted risk:
  the model could reword/drop content.)
- If a returned chunk still exceeds 4096, the Telegram send fails and the
  existing catch-all sends the apology. (Accepted edge case.)

## Components

### 1. Engine node — `src/engine/nodes/ai/chunk-message.node.ts` (new)

Generic and reusable, like `AiAgentNode`; depends only on the `ChatModel` port,
so the engine stays app-free.

```ts
import { Node } from '../../node';
import type { ChatModel } from '../../ai/chat-model';

export interface ChunkMessageInput {
  text: string;
  chatModel: ChatModel;
  maxChars?: number; // per-message ceiling hinted to the model; default 4096
}

export interface ChunkMessageOutput {
  chunks: string[];
}

export class ChunkMessageNode extends Node<ChunkMessageInput, ChunkMessageOutput>;
```

Behavior:

1. Build a single user message instructing the model to split the text:
   *"Split the following chat message into multiple shorter messages at natural
   topic boundaries. Preserve ALL content exactly — do not reword, summarise,
   add, or drop anything; only split. Each message must be at most {maxChars}
   characters. Return ONLY a JSON array of strings, nothing else."* followed by
   the text. (`maxChars` defaults to 4096.)
2. `const res = await chatModel.complete({ messages: [{ role: 'user', content }] })`.
3. Parse `res.message.content` robustly: take the substring from the first `[`
   to the last `]`, `JSON.parse` it, and validate it is a non-empty array whose
   every element is a non-empty string.
4. On valid parse → `{ chunks }`. On **any parse/validation failure** →
   `{ chunks: [text] }` (the whole text as one chunk — graceful).
5. A thrown error from `chatModel.complete` (network/timeout/non-OK) propagates;
   the caller handles it.

Export `ChunkMessageNode`, `ChunkMessageInput`, `ChunkMessageOutput` from
`src/engine/index.ts`.

This node makes its own LLM call (one extra round-trip per long reply) — that is
the cost of semantic chunking and is accepted.

### 2. Channel trigger flow — `src/app/workflows/telegram.workflow.ts`

Add a module-level constant and replace the single reply send with a
check → chunk → loop:

```ts
const CHUNK_THRESHOLD = 500; // replies longer than this get AI-chunked

// … inside the workflow, after `result = await wf.runWorkflow(conversationWorkflow, …)`:

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
    // fallback: leave `chunks` as the whole reply
  }
}

for (const chunk of chunks) {
  await wf.run(TelegramSendMessageNode, {
    botToken: appConfig.telegramBotToken,
    chatId: parsed.chat.id,
    text: chunk,
  });
}

await new PgChatMemory({ sessionId }).append(result.messages);
```

`telegram.workflow.ts` re-adds the `OpenRouterChatModel` and `ChunkMessageNode`
imports from `../../engine`. The memory commit stays after the whole send loop —
a mid-loop send failure throws into the existing catch-all (apology + rethrow),
so memory is not committed on partial delivery (unchanged invariant).

The threshold and chunking are intentionally in the channel (trigger flow);
Messenger will call the same `ChunkMessageNode` when it is built.

## Memory & trace

Memory persists the full reply as one assistant turn (chunking is delivery-only).
The trace gains a `ChunkMessageNode` step plus N `TelegramSendMessageNode` steps
for a long reply; short replies (≤ threshold) keep a single send step and skip
the chunk node entirely.

## Testing

- **`src/engine/nodes/ai/chunk-message.node.spec.ts`** (new), with a fake
  `ChatModel`:
  - returns the parsed array when the model replies with a JSON array of strings;
  - strips a ```json … ``` fence / surrounding prose (first `[` … last `]`);
  - non-JSON content → `{ chunks: [text] }`;
  - empty array / array with a non-string → `{ chunks: [text] }`;
  - the prompt includes the `maxChars` value and the input text.
- **`src/app/workflows/telegram.workflow.spec.ts`** (updated):
  - a long agent reply (> 500 chars) where the chunk call returns `["a", "b"]`
    produces two `TelegramSendMessageNode` sends in order (the `fetch` mock
    distinguishes the agent call from the chunk call by request body — the agent
    body contains the "Better Solutions" system prompt, the chunk body contains
    the chunk instruction);
  - a short reply (≤ 500) sends once and never calls the chunk node;
  - when the chunk call fails (model returns a non-OK status for the chunk
    request), the whole reply is sent as one message.

No live testing — the user verifies the running bot.

## Out of scope

- Messenger reuse (it will call `ChunkMessageNode` when built).
- Pacing / rate-limit handling between chunk sends.
- Verifying the chunks reconstruct the original text.
