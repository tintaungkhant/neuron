# Token Logging Design

**Date:** 2026-06-06
**Status:** Approved

## Goal

Per-execution observability of LLM token usage: see **per-node** tokens and
**per-workflow** total tokens for each run. No cost-aggregation, no per-session
billing — just visibility on the existing execution/trace surface.

## Scope

- Capture token usage from every LLM call (OpenRouter chat model, Gemini
  read-media node).
- Attach per-node usage to each trace step.
- Aggregate per-workflow total (recursive across sub-workflows).
- Persist the workflow total on the `executions` row.
- Surface usage in `formatTrace` output for at-a-glance reading.

Engine-pure: no imports from `src/app/`, no env reads. The chat model continues
to take credentials via constructor only.

## Design

### 1. `TokenUsage` type

Defined in `src/engine/trace.ts` (core, imports nothing):

```ts
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

`src/engine/ai/chat-model.ts` imports it.

### 2. ChatModel returns usage

`ChatCompletionResult` gains `usage?: TokenUsage`.

`OpenRouterChatModel.complete` parses `json.usage`
(`prompt_tokens` / `completion_tokens` / `total_tokens`) into `TokenUsage`.
Absent usage → `undefined`, no crash (defensive, like existing parsing).

### 3. AiAgentNode sums across the turn

The agent loop calls `chatModel.complete` up to `maxSteps` times. Each call's
`usage` is summed into one `TokenUsage` for the turn (prompt grows each step, so
the sum is the real spend). Added to `AiAgentOutput.usage`.

If no call reported usage, `usage` is omitted (undefined).

### 4. Gemini read-media returns usage

`read-media.node.ts` parses `usageMetadata`
(`promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`) into
`GeminiReadMediaOutput.usage`. Absent → undefined.

### 5. Per-node usage on the trace

`TraceStep` gains `usage?: TokenUsage`.

`enrichStep` (in `trace-format.ts`) lifts a `usage` field off the node output
onto `step.usage` and strips it from the stored output — the same convention
already used for `toolSteps`. `ContextImpl` stays token-blind; no engine
coupling to the token convention beyond the trace formatter.

Sub-workflow steps get `step.usage = sumTokens(childTrace)`.

### 6. Per-workflow total

`sumTokens(trace): TokenUsage` in `trace-format.ts`, recursive: sums each node
step's `usage` plus each sub-workflow's total. Tool steps carry no usage.

### 7. Persist on executions

`executions` schema (`src/engine/db/schema.ts`) gains three integer columns,
default `0`:

- `tokens_prompt`
- `tokens_completion`
- `tokens_total`

`ExecutionStore.save` calls `sumTokens(enriched)` and writes the three columns.
`ExecutionSummary` and `ExecutionRecord` expose them.

Migration generated via `pnpm db:generate`; default `0` backfills existing rows.

### 8. formatTrace annotation

Append token counts to the rendered flow:

- per-node: `ai agent (1098ms · 1240 tok)`
- workflow line: `demoTelegramHiWorkflow ✓ 1200ms · 1240 tok`

Nodes with no usage show no token suffix. Counts use `totalTokens`.

## Testing

- `openrouter-chat-model.spec` — `usage` parsed from response; absent usage → undefined.
- `agent.node.spec` — usage summed across a multi-step (tool-calling) turn.
- `read-media.node.spec` — `usageMetadata` parsed into `usage`.
- `trace-format.spec` — `enrichStep` lifts/strips `usage`; `sumTokens` recursion
  including a sub-workflow; `formatTrace` token suffix.

`ExecutionStore` (DB-backed) is not unit-tested, consistent with current specs.

## Out of scope

- Per-session / per-chat cost aggregation.
- Cost (currency) calculation.
- Token budgets or enforcement.
