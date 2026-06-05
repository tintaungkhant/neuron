# Code Weaknesses — Review 2026-06-05

Snapshot review of the Neuron engine + Telegram sales-bot app. Findings are
prioritized; each has location, problem, impact, and a fix direction. Status:
**OPEN** (to fix), **DEFERRED** (intentionally postponed), **FIXED** (done, kept
for context).

Priority order to tackle: (1) per-chat serialization, (2) `create_order`
idempotency, (3) `chats.ext_id` unique+upsert. The first is highest leverage —
it fixes the memory race, curbs double-orders, and tames albums at once.

---

## HIGH

### 1. No per-chat serialization (concurrency) — OPEN
- **Where:** `src/app/controllers/telegram.controller.ts` (awaits `engine.run` per webhook), `src/engine/nodes/ai/pg-chat-memory.ts`.
- **Problem:** Telegram delivers updates concurrently. Two fast messages from the same user → two workflow runs in parallel on the **same session**, with nothing serializing them.
- **Impact:**
  - Memory race: both turns `load()` the same window and `append()` → interleaved / out-of-order history (B's reply can persist before A's).
  - Double actions: two parallel turns can both reach `create_order`.
  - Amplified by albums: the per-image decision means a 10-photo album = 10 concurrent Gemini pipelines + 10 agent turns on one session at once — worst case.
- **Fix direction:** per-chat mutex/queue keyed by `chat.id` — in-memory lock for a single instance, or a Postgres advisory lock / queue for multi-instance. Serializes runs per chat without blocking different chats.

### 2. `create_order` is not idempotent — OPEN
- **Where:** `src/app/tools/create-order.tool.ts`.
- **Problem:** Inserts a new `orders` row on every call, no dedup. Combined with the canned-apology flow: a turn that fails *after* `create_order` succeeded (e.g. the reply send times out) makes the user resend → the model re-confirms and calls `create_order` again → **duplicate order**. The apology UX increases resend likelihood.
- **Impact:** Duplicate / double-charged orders.
- **Fix direction:** idempotency — e.g. one open order per chat, or dedupe on (chatId, summary) within a time window, or a client-supplied idempotency key.

### 3. `chats.ext_id` has no unique constraint — FIXED (2026-06-05)
> Resolved: `ext_id` is now `notNull().unique()` and the workflow upserts with `onConflictDoNothing` (no pre-select). Migration `drizzle-app/0003_*`. Note: existing duplicate/null `ext_id` rows must be cleaned before applying.
- **Where:** `src/app/db/schema.ts` (`chats`), `src/app/workflows/telegram-hi.workflow.ts` (select-then-insert).
- **Problem:** No unique index on `ext_id`; the workflow does select-then-insert. Concurrent first messages both see "not found" and both insert.
- **Impact:** Duplicate chat rows.
- **Fix direction:** unique index on `ext_id` + `insert ... onConflictDoNothing` (drop the pre-select). Same root cause as #1.

---

## MEDIUM

### 4. Memory recorded before the reply is sent — FIXED (2026-06-05)
> Resolved: `AiAgentNode` no longer persists; the workflow calls `memory.append(agent.messages)` only after a successful send.
- **Where:** `src/engine/nodes/ai/agent.node.ts` (appends turn to memory), then `src/app/workflows/telegram-hi.workflow.ts` sends.
- **Problem:** The agent appends the user+assistant turn to memory *before* the workflow sends the reply. If the send fails → apology goes out, but memory already stored an assistant reply the user never saw.
- **Impact:** Memory/reality mismatch — next turn the model believes it said something it didn't (mild poisoning).
- **Fix direction:** commit to memory only after a successful send (move persistence out of the agent into the workflow, or send-then-commit).

### 5. Fragile upstream parsing — FIXED (2026-06-05)
> Resolved: `complete()` guards `choices?.[0]?.message` (throws "no message in response"); tool-call arguments parse via a wrapped helper that throws "invalid JSON arguments for tool ..." instead of an opaque crash.
- **Where:** `src/engine/nodes/ai/openrouter-chat-model.ts` (`json.choices[0].message`, `JSON.parse(c.function.arguments)`).
- **Problem:** Assumes `choices[0]` exists; `JSON.parse` of model-supplied tool-call arguments can throw on malformed output.
- **Impact:** Turn fails (now degrades to the canned apology rather than crashing, but still a lost turn).
- **Fix direction:** guard `choices`/`message`; wrap `JSON.parse` and treat a parse failure as a tool-arg error.

---

## LOW / observability

### 6. Failed tools vanish from the trace — FIXED (2026-06-05)
> Resolved: the agent wraps a propagated tool failure as `tool "<name>" failed after N attempt(s): <reason>`, so the trace's errored agent step names the failing tool and attempt count. (A fully structured failed `toolStep` would need the node not to throw — error message is the pragmatic surface.)
- **Where:** `src/engine/nodes/ai/agent.node.ts` retry loop.
- **Problem:** On retry-exhaustion the tool throws before its `toolStep` is pushed, so `executions` shows the agent node errored but not which tool or how many attempts.
- **Fix direction:** record a failed `toolStep` (status `error`, attempts) before propagating.

### 7. Retry count uncapped, no overall turn timeout — FIXED (2026-06-05)
> Resolved: tool retry count is hard-capped at 5 (`MAX_TOOL_RETRIES`); the agent has a wall-clock turn budget (`maxTurnMs`, default 120s) checked between steps, throwing `turn exceeded …` past the deadline.
- **Where:** `src/engine/nodes/ai/agent.node.ts` (`tool.retry.count`), per-call timeouts only.
- **Problem:** A tool with `retry.count: 1000, delayMs: 1000` stalls ~17 min; per-call timeouts don't bound the whole turn.
- **Fix direction:** cap retry count, and/or add a per-turn time budget.

### 8. Trace bloat & duplication — FIXED (2026-06-05, retention still open)
> Resolved: `enrichTrace` strips the duplicated `toolSteps` from a node's output after folding into `children`; `truncateTrace` caps long strings (system prompts, big outputs) at 4000 chars before persist. **Still open:** a retention/prune job for old `executions` rows (ops task, no scheduler yet).
- **Where:** `src/engine/trace-format.ts` (`enrichTrace`), `src/engine/executions/execution-store.ts`.
- **Problem:** `enrichTrace` leaves `output.toolSteps` *and* adds `children` (same data twice); the full `systemPrompt` is stored in every row; no retention on `executions`.
- **Impact:** Storage grows fast.
- **Fix direction:** strip `output.toolSteps` after folding into `children`; consider truncating large fields; add a retention/prune job.

### 9. Non-message updates throw noise — FIXED (2026-06-05)
> Resolved: `TelegramWebhookNode` returns `null` for updates with no `message` (edits, reactions, callbacks); the workflow early-returns on `null` — no error, no failed-run noise.
- **Where:** `src/engine/nodes/telegram/webhook.node.ts` (throws on no `message`); parse runs outside the workflow try.
- **Problem:** Edited messages, reactions, callback queries throw → logged as errors with no apology (no chat context).
- **Fix direction:** ignore non-message updates gracefully (return early, no error).

---

## DEFERRED (intentional, from prior review)

- **Secrets persisted in `executions.trace`** — OpenRouter/Gemini API keys and the Telegram bot token are serialized into the trace JSONB. Waived: if the DB is compromised, masked keys are moot anyway.
- **Webhook unauthenticated** — no Telegram `secret_token` verification on `POST /webhook`. Waived for now.
- **Nullable schema columns** — `chats.ext_id`, `orders.chat_id`, `payment_methods.*`, `faqs.*` are nullable; several should be `notNull`.
- **Gemini Files API cleanup** — uploaded files are never deleted (rely on the 48h TTL).

---

## FIXED (this session, for context)

- External-call timeouts (`fetchWithTimeout`, per-call overridable) — OpenRouter/Telegram/Gemini.
- Deterministic canned apology on any turn failure (no tech leak, no auto-retry).
- Per-tool opt-in tool-call retry (default 0).
- `maxSteps` exhaustion now degrades to the apology instead of crashing.
