# Router Node — Design

**Date:** 2026-06-06
**Branch:** `feat/router`
**Status:** Approved (design); spec pending user review

## Problem

The sales agent runs off one mega `SYSTEM_PROMPT` (`src/app/conversation/conversation.workflow.ts`) that handles six concerns at once: persona, grounding, language, formatting/lists, a 6-step conversation flow, and tone. One LLM call carrying all of it dilutes instruction-following. Observed symptoms:

- fabricated "reply with 1" CTA when no real selection menu was shown,
- foreign-script leakage (non-Burmese/non-Latin characters in replies),
- over-chunking of replies.

This is a **separation-of-concerns** problem before it is a token problem. The fix is to decompose the *work* per turn, not to enumerate every user intent in code. (Hard-won constraint from the user: do not rely on deterministic code to cover semantic intents — code stays for mechanical post-processing only.)

## Chosen approach: router node (stage-label-only)

Add a cheap classifier call before the agent call. It picks the current conversation **stage**; the workflow then loads only that stage's instructions plus a small always-on core. The agent sees a fraction of the rules each turn, so each rule competes for less attention.

This is the **routing** pattern (Anthropic "Building Effective Agents"): classify input → dispatch to specialized follow-up. Single-agent engine is preserved; no multi-agent handoff machinery (deferred until the rule of three is met).

Tool-gating per stage and a cheaper router model are explicitly **out of scope** for v1.

## Components

### 1. `ClassifyNode` (engine, generic)

`src/engine/nodes/ai/classify.node.ts`. LLM-backed single-shot node, mirroring `ChunkMessageNode`.

- **Input:** `{ input: string, history?: ChatMessage[], options: { label: string; description: string }[], chatModel: ChatModel, instructions?: string }`
- **Output:** `{ label: string }`
- Builds a tight classification prompt from the `options` list (each label + description) and the recent `history`, calls `chatModel.complete`, and resolves to exactly one label from `options`.
- **Fallback:** if the model returns anything not in `options` (or unparseable), return `options[0].label`. The caller orders `options` so `options[0]` is the safe default.
- Engine-generic: knows nothing about sales stages. The app supplies the stage list. Preserves the one-way `engine/` → (never) `app/` boundary.
- Exported from `src/engine/index.ts` alongside the other AI nodes.

### 2. App prompt split

`src/app/conversation/conversation.workflow.ts`. Today's `SYSTEM_PROMPT` is decomposed into:

- **CORE** (always-on, small): persona/role, language rules (incl. the Burmese/English-only / no-foreign-script rule), plain-text + numbered-list essentials, a one-line grounding pointer ("facts come only from tools, never from memory"), and tone basics. Redundant/overlapping sentences from the current prompt are cut during the split.
- **STAGE_BLOCKS**: a `Record<Stage, string>` holding the six current flow sections, each rewritten as a focused standalone block:
  - `discovery` — new/broad customer; greet + qualifying questions
  - `recommend` — after situation shared; 2–3 relevant services as a numbered menu
  - `deep_dive` — specific service picked; pricing + requirements list
  - `faq` — "how/why/can you" questions; get_faqs first
  - `close` — requirements collected; summarize, confirm, create_order
  - `payment` — payment-method / pricing inquiries

The detailed "when to call which tool" grounding already lives in the tool `description`s (`get_services`, `get_faqs`, `get_payment_methods`, `create_order`); it stays there. CORE only points at it in one line.

### 3. Stage assembly (pure function)

A small pure helper in the app, e.g. `buildSystemPrompt(stage: Stage): string` returning `CORE + "\n\n" + STAGE_BLOCKS[stage]`. Unknown stage → `discovery`. Unit-testable without any model.

### 4. Workflow wiring

`conversationWorkflow` becomes:

```
const memory  = new PgChatMemory({ sessionId })
const history = await memory.load()
const chatModel = new OpenRouterChatModel({ apiKey, model })

const { label } = await wf.run(ClassifyNode, {
  input: input.text,
  history,                 // recent window — needed to read bare "1" / "yes"
  options: STAGE_OPTIONS,  // discovery first = fallback
  chatModel,
})

const agent = await wf.run(AiAgentNode, {
  input: input.text,
  systemPrompt: buildSystemPrompt(label),
  chatModel,
  memory,
  tools: [ ...same as today ],
})

return { reply: stripMarkdown(agent.output), messages: agent.messages }
```

Notes:
- `memory.load()` is called once in the workflow and passed to `ClassifyNode`. `AiAgentNode` still loads memory internally (it owns its history) — a small double-load, accepted for simplicity in v1.
- `history` window for classification: last ~6 messages (the existing `PgChatMemory` window of 20 already bounds it; the classify prompt may further cap to the last 6 to keep the call cheap).
- Both calls share one `OpenRouterChatModel` instance.

## Router context + fallback

- The router needs recent history, not just the latest message: stage often depends on conversation state (a bare `"1"` after a menu = `recommend`/`deep_dive` selection; `"yes"` after a summary = `close`).
- Fallback stage is `discovery` — a warm, safe general handler when classification is ambiguous or fails.

## Code guards — unchanged

- `stripMarkdown` (formatting enforcement) and `ChunkMessageNode` (chunking) stay as-is.
- Foreign-script enforcement stays a **prompt rule** inside CORE (no new code guard), honoring the "don't code every intent" constraint. Revisit only if leakage persists after the split.

## Tracing

`wf.run(ClassifyNode, ...)` is auto-recorded as a `Trace` step, so each `executions` row shows the stage chosen that turn — free per-turn debugging of routing decisions.

## Testing (no live runs)

Per project rule, no `pnpm start:dev` / live integration. Unit specs only:

- `classify.node.spec.ts`: stubbed `chatModel` returns a known label → returned; returns garbage / unknown label → fallback to `options[0]`. (Pattern: `chunk-message.node.spec.ts`.)
- App prompt-assembly spec: `buildSystemPrompt(stage)` composes `CORE + STAGE_BLOCKS[stage]`; unknown stage → `discovery` block.

## Effect

- Agent call shrinks from CORE+6-blocks to CORE+1-block → fewer competing rules, sharper following.
- Adds one small classify call per turn (label list + short history, no big rules) — modest latency/token cost, accepted.
- Net per-turn token change is roughly neutral-to-lower while instruction-following improves.

## Out of scope (deferred)

- Per-stage tool-gating (stage → allowed tool subset).
- Separate cheaper/faster router model + its config/env.
- Multi-agent handoffs.
- A deterministic foreign-script post-filter.

These wait for evidence (rule of three / persistent symptoms).
