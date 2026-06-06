# Router Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the sales agent's mega system prompt into a small always-on core plus one per-turn stage block, selected by a new generic LLM classifier node, so each agent call carries a fraction of the rules and follows them better.

**Architecture:** A new engine-generic `ClassifyNode` (LLM-backed, single-shot, like `ChunkMessageNode`) returns one stage label from a caller-supplied list. The app's `conversationWorkflow` loads chat history, runs `ClassifyNode` to pick a stage, composes `CORE + STAGE_BLOCKS[stage]`, and passes that as the agent's `systemPrompt`. Grounding rules stay in the existing tool descriptions; mechanical guards (`stripMarkdown`, `ChunkMessageNode`) are unchanged.

**Tech Stack:** TypeScript (nodenext/CommonJS), NestJS 11, Jest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-06-router-node-design.md`

---

## File Structure

- **Create** `src/engine/nodes/ai/classify.node.ts` — generic `ClassifyNode` + its input/output/option types. Engine-generic; knows nothing about sales stages.
- **Create** `src/engine/nodes/ai/classify.node.spec.ts` — unit spec for `ClassifyNode`.
- **Modify** `src/engine/index.ts` — export `ClassifyNode` and its types.
- **Create** `src/app/conversation/prompt.ts` — `Stage` type, `CORE`, `STAGE_BLOCKS`, `STAGE_OPTIONS`, `buildSystemPrompt()`. App-specific; holds the split prompt.
- **Create** `src/app/conversation/prompt.spec.ts` — unit spec for `buildSystemPrompt()` and `STAGE_OPTIONS`.
- **Modify** `src/app/conversation/conversation.workflow.ts` — remove the inline `SYSTEM_PROMPT`, classify then build the prompt per turn.
- **Modify** `src/app/conversation/conversation.workflow.spec.ts` — account for the extra `ClassifyNode` trace step and the classify OpenRouter call.

---

## Task 1: `ClassifyNode` (engine, generic)

**Files:**
- Create: `src/engine/nodes/ai/classify.node.ts`
- Test: `src/engine/nodes/ai/classify.node.spec.ts`
- Modify: `src/engine/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engine/nodes/ai/classify.node.spec.ts`:

```typescript
import { ClassifyNode, type ClassifyOption } from './classify.node';
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

const OPTIONS: ClassifyOption[] = [
  { label: 'discovery', description: 'new or broad' },
  { label: 'recommend', description: 'ready for suggestions' },
  { label: 'close', description: 'confirming the order' },
];

describe('ClassifyNode', () => {
  it('returns the label when the model replies with exactly a label', async () => {
    const out = await new ClassifyNode().execute({
      input: 'sounds good, go ahead',
      options: OPTIONS,
      chatModel: new FakeChatModel('close'),
    });
    expect(out.label).toBe('close');
  });

  it('matches case-insensitively and inside surrounding text', async () => {
    const out = await new ClassifyNode().execute({
      input: 'x',
      options: OPTIONS,
      chatModel: new FakeChatModel('Label: RECOMMEND'),
    });
    expect(out.label).toBe('recommend');
  });

  it('falls back to the first option when the reply matches nothing', async () => {
    const out = await new ClassifyNode().execute({
      input: 'x',
      options: OPTIONS,
      chatModel: new FakeChatModel('I am not sure'),
    });
    expect(out.label).toBe('discovery');
  });

  it('includes the labels, the input, and recent history in the prompt', async () => {
    const model = new FakeChatModel('discovery');
    await new ClassifyNode().execute({
      input: 'HELLO-INPUT',
      history: [
        { role: 'user', content: 'OLD-MSG' },
        { role: 'assistant', content: 'PRIOR-REPLY' },
      ],
      options: OPTIONS,
      chatModel: model,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).toContain('discovery');
    expect(sent).toContain('recommend');
    expect(sent).toContain('HELLO-INPUT');
    expect(sent).toContain('OLD-MSG');
    expect(sent).toContain('PRIOR-REPLY');
  });

  it('keeps only the last historyWindow messages', async () => {
    const model = new FakeChatModel('discovery');
    await new ClassifyNode().execute({
      input: 'x',
      history: [
        { role: 'user', content: 'TOO-OLD' },
        { role: 'assistant', content: 'KEEP-1' },
        { role: 'user', content: 'KEEP-2' },
      ],
      options: OPTIONS,
      chatModel: model,
      historyWindow: 2,
    });
    const sent = model.calls[0].messages[0].content;
    expect(sent).not.toContain('TOO-OLD');
    expect(sent).toContain('KEEP-1');
    expect(sent).toContain('KEEP-2');
  });

  it('throws when options is empty', async () => {
    await expect(
      new ClassifyNode().execute({
        input: 'x',
        options: [],
        chatModel: new FakeChatModel('anything'),
      }),
    ).rejects.toThrow(/options/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- classify.node`
Expected: FAIL — `Cannot find module './classify.node'`.

- [ ] **Step 3: Write the implementation**

Create `src/engine/nodes/ai/classify.node.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';

const DEFAULT_HISTORY_WINDOW = 6;

export interface ClassifyOption {
  label: string;
  description: string;
}

export interface ClassifyInput {
  input: string;
  history?: ChatMessage[];
  options: ClassifyOption[];
  chatModel: ChatModel;
  instructions?: string; // optional preamble prepended to the classify prompt
  historyWindow?: number; // recent messages to include; default 6
}

export interface ClassifyOutput {
  label: string;
}

@Injectable()
export class ClassifyNode extends Node<ClassifyInput, ClassifyOutput> {
  async execute(input: ClassifyInput): Promise<ClassifyOutput> {
    const { options } = input;
    if (options.length === 0) {
      throw new Error('ClassifyNode: options must not be empty');
    }

    const window = input.historyWindow ?? DEFAULT_HISTORY_WINDOW;
    const recent: ChatMessage[] = (input.history ?? []).slice(-window);

    const optionLines = options
      .map((o) => `- ${o.label}: ${o.description}`)
      .join('\n');
    const historyText = recent.length
      ? recent.map((m) => `${m.role}: ${m.content}`).join('\n')
      : '(no prior messages)';

    const prompt =
      (input.instructions ? `${input.instructions}\n\n` : '') +
      `Classify the customer's latest message into exactly ONE of these labels:\n` +
      `${optionLines}\n\n` +
      `Recent conversation:\n${historyText}\n\n` +
      `Latest message:\n${input.input}\n\n` +
      `Reply with ONLY the single best-matching label, exactly as written above, and nothing else.`;

    const res = await input.chatModel.complete({
      messages: [{ role: 'user', content: prompt }],
    });

    return { label: resolveLabel(res.message.content, options) };
  }
}

// Map the model's reply to a known label: exact match (case-insensitive)
// first, then substring containment. Anything unrecognized → the first
// option, which the caller orders to be the safe default.
function resolveLabel(raw: string, options: ClassifyOption[]): string {
  const text = raw.trim().toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === text);
  if (exact) return exact.label;
  const contained = options.find((o) => text.includes(o.label.toLowerCase()));
  if (contained) return contained.label;
  return options[0].label;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- classify.node`
Expected: PASS (6 tests).

- [ ] **Step 5: Export from the engine barrel**

In `src/engine/index.ts`, add directly below the existing `ChunkMessageNode` export block:

```typescript
export { ClassifyNode } from './nodes/ai/classify.node';
export type {
  ClassifyInput,
  ClassifyOutput,
  ClassifyOption,
} from './nodes/ai/classify.node';
```

- [ ] **Step 6: Verify the build and lint**

Run: `pnpm build`
Expected: succeeds, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/engine/nodes/ai/classify.node.ts src/engine/nodes/ai/classify.node.spec.ts src/engine/index.ts
git commit -m "feat(engine): add generic ClassifyNode for stage routing"
```

---

## Task 2: App prompt split (`CORE`, `STAGE_BLOCKS`, `buildSystemPrompt`)

**Files:**
- Create: `src/app/conversation/prompt.ts`
- Test: `src/app/conversation/prompt.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/conversation/prompt.spec.ts`:

```typescript
import {
  CORE,
  STAGE_BLOCKS,
  STAGE_OPTIONS,
  buildSystemPrompt,
  type Stage,
} from './prompt';

describe('buildSystemPrompt', () => {
  it('composes CORE followed by the requested stage block', () => {
    const out = buildSystemPrompt('recommend');
    expect(out.startsWith(CORE)).toBe(true);
    expect(out).toContain(STAGE_BLOCKS.recommend);
  });

  it('falls back to the discovery block for an unknown stage', () => {
    const out = buildSystemPrompt('nonsense');
    expect(out).toContain(STAGE_BLOCKS.discovery);
  });

  it('every STAGE_OPTIONS label has a matching block, discovery first', () => {
    expect(STAGE_OPTIONS[0].label).toBe('discovery');
    for (const opt of STAGE_OPTIONS) {
      expect(STAGE_BLOCKS[opt.label as Stage]).toBeDefined();
    }
  });

  it('CORE keeps the persona and the no-foreign-script rule', () => {
    expect(CORE).toContain('Better Solutions');
    expect(CORE).toMatch(/writing system/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- prompt.spec`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/conversation/prompt.ts`. This is the old `SYSTEM_PROMPT` split into an always-on `CORE` plus one block per stage; redundant lines were merged during the split. Detailed "when to call which tool" guidance intentionally stays in the tool `description`s and is only pointed at here.

```typescript
import type { ClassifyOption } from '../../engine';

export type Stage =
  | 'discovery'
  | 'recommend'
  | 'deep_dive'
  | 'faq'
  | 'close'
  | 'payment';

// Always-on rules: persona, grounding pointer, language, formatting, tone.
// Kept small so every turn carries only these plus one stage block.
export const CORE = `You are a friendly sales consultant for "Better Solutions", a Myanmar-based digital marketing agency. We help businesses grow through Facebook & TikTok advertising, content creation, graphic design, motion video, and page management.

Have a natural, helpful conversation — never dump information. Think like a store assistant: greet, understand the customer's situation, then guide them to the right solution.

## Grounding (non-negotiable)
You do NOT know our catalog, prices, FAQs, or payment details from memory. NEVER answer these from your own knowledge and NEVER make up a service name, price, or account number. Whenever facts are needed — what we offer, whether a specific service exists, pricing, how-to/FAQ questions, or payment details — call the relevant tool FIRST and answer ONLY from its result. The tool descriptions say exactly when to call each one. This holds even mid-chat, before discovery is finished: grounding first, conversation second. Never confirm or deny that a service exists from memory — call get_services first, even when the customer assumes we don't offer it.

## Language
- Reply in the SAME language the customer writes in. Most write Burmese — reply in natural, friendly, conversational Burmese, the way a real Myanmar shop assistant chats, not stiff textbook Burmese. If they write English, reply in English. If they mix, follow whichever they mostly use.
- Keep service names, package names, prices, and payment account names/numbers EXACTLY as they appear in the data (e.g. "Blue Mark Verification Service", "50000 MMK") — never translate or alter them. Localize only the words around them.
- Language applies only to your final reply. Tool calls and the data you read stay as-is.
- Write replies using ONLY Burmese (Myanmar) script and/or English (Latin) letters and digits — plus the exact catalog/account names as given. NEVER insert characters from any other writing system (no Chinese/Japanese/Korean, Thai, Cyrillic, etc.). If a non-Burmese, non-English word slips in, replace it with the correct Burmese or English word before sending.

## Formatting
- Plain text ONLY. Telegram shows raw symbols, so NEVER use markdown: no **bold**, *italics*, # headings, backticks, or "-"/"*" bullets. Write like a normal chat message.
- Number EVERY list. The moment you mention two or more items, format them as 1, 2, 3 … each on its own line (sub-items 1.a, 1.b). Never use dashes, asterisks, or comma-runs for multiple items.
- Keep lists SHORT — never dump the whole catalog. Show at most about 5 of the most relevant items, then offer to narrow down. Show everything only if the customer explicitly asks.
- Two kinds of list: SELECTION MENUS (two or more options the customer picks from) and INFO LISTS (things you tell them or ask them to provide). Both are numbered, but ONLY a selection menu is pick-by-number. NEVER tell the customer to "reply with 1" (or any number) unless you have actually shown two or more options to choose between — for a single item or an info list there is nothing to pick, so that line would be false.
- When the customer replies with a bare number or code like "1" or "1.a", treat it as picking that item from YOUR most recent selection menu and continue. If there's no recent menu, ask which option they mean.

## Tone
- Be warm and human. Use occasional emojis naturally — not forced.
- Keep every message under about 4 short paragraphs; split it or offer more detail if it would run longer.
- Never output raw JSON, table dumps, or database fields verbatim — rephrase into natural conversation.
- If the customer sends something unrelated, acknowledge it briefly and steer back to how we can help their business.
- When you need several pieces of information, lay out the full list up front, then follow up only on what's still missing. Don't drip questions one at a time.`;

// One block is appended to CORE per turn, chosen by the router.
export const STAGE_BLOCKS: Record<Stage, string> = {
  discovery: `## Now: DISCOVERY
The customer is new or asking broadly ("what do you offer?", "hi", "help me").
- Greet warmly in one sentence. Mention we specialize in social media marketing — Facebook/TikTok ads, content writing, design, and video.
- Then ask 2-3 short qualifying questions together in ONE short message (not one by one): what kind of business they run, whether they're already active on Facebook/TikTok, and their main goal right now (more followers? more sales? better content? just exploring?).`,

  recommend: `## Now: RECOMMEND
The customer has shared their situation.
- Call get_services. Pick the 2-3 most relevant services for their answers.
- Present them as a numbered selection menu — each on its own line: number, service name (plain text), a 1-line summary, and the starting price. Because this is a real menu of two or more options, you MAY tell them to reply with the number to go deeper.
- Do NOT list all services or dump full pricing tables. Offer to go deeper on whichever one interests them.`,

  deep_dive: `## Now: SERVICE DEEP-DIVE
The customer picked or asked about a specific service.
- Call get_services first (unless you already have its result this turn). Confirm the service exists in the result before saying anything about it — if it's not there, say we don't offer it.
- Show the full pricing for that service from the result (readable, not a raw table).
- Then lay out the FULL requirements list from the service's requirementsFromCustomer field as a numbered INFO LIST (not a pick-one menu — do NOT tell them to reply with a number). Invite them to send what they can. After they reply, acknowledge what you received and ask ONLY for the items still missing, together in one short follow-up. Never re-ask for something already given.`,

  faq: `## Now: FAQ / GENERAL ADVICE
The customer asked "how do I...", "why is...", or "can you...".
- Call get_faqs. If a question clearly matches, summarize that answer (don't paste it raw). If nothing matches and it's about a service or price, call get_services rather than guessing. Only fall back to general marketing common-sense when no tool covers it — never invent our specifics.
- Keep advice actionable and short.`,

  close: `## Now: CLOSE & PAYMENT
All requirements are collected.
- Summarize the service, what they'll get, and the price. Ask "Shall I place this order for you?"
- ONLY after they confirm (yes/ok/go ahead/proceed) call create_order with a summary including: service name, all requirements collected, agreed price, and payment method if discussed. NEVER call create_order without explicit confirmation.
- After creating the order, call get_payment_methods and share 1-2 payment options briefly (account name, account number). Ask them to send a screenshot after transferring.`,

  payment: `## Now: PAYMENT INQUIRIES
The customer asked about payment methods or prices.
- Call get_payment_methods. List 2-3 options as a numbered list (one line each: number, method name + account number).`,
};

// Router options. discovery is first so it is ClassifyNode's safe fallback.
export const STAGE_OPTIONS: ClassifyOption[] = [
  {
    label: 'discovery',
    description:
      'New customer, a greeting ("hi", "help"), or a broad "what do you offer?" — their situation is not yet known.',
  },
  {
    label: 'recommend',
    description:
      'The customer has shared their business or goal and is ready for service suggestions.',
  },
  {
    label: 'deep_dive',
    description:
      'The customer picked or asked about ONE specific service, or replied with a number selecting from a service menu — they want its pricing and requirements.',
  },
  {
    label: 'faq',
    description:
      'A how/why/can-you question or a general advice request not tied to placing an order.',
  },
  {
    label: 'close',
    description:
      'Requirements are gathered and the customer is confirming or placing the order ("yes", "ok", "go ahead").',
  },
  {
    label: 'payment',
    description:
      'The customer is asking about payment methods, accounts, or how to pay.',
  },
];

// Compose the per-turn system prompt: always-on CORE plus the chosen stage
// block. Unknown stage → discovery (matches ClassifyNode's fallback).
export function buildSystemPrompt(stage: string): string {
  const block = STAGE_BLOCKS[stage as Stage] ?? STAGE_BLOCKS.discovery;
  return `${CORE}\n\n${block}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- prompt.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/conversation/prompt.ts src/app/conversation/prompt.spec.ts
git commit -m "feat(app): split sales prompt into CORE + per-stage blocks"
```

---

## Task 3: Wire the router into `conversationWorkflow`

**Files:**
- Modify: `src/app/conversation/conversation.workflow.ts`
- Modify: `src/app/conversation/conversation.workflow.spec.ts`

- [ ] **Step 1: Update the workflow spec to expect the classify step**

The current spec asserts the trace has only `AiAgentNode` and finds the first OpenRouter call (which will now be the classify call, a single user message with no system role). Update both.

In `src/app/conversation/conversation.workflow.spec.ts`, change the trace assertion (currently line 75) from:

```typescript
    expect(trace.steps.map((s) => s.name)).toEqual(['AiAgentNode']);
```

to:

```typescript
    expect(trace.steps.map((s) => s.name)).toEqual([
      'ClassifyNode',
      'AiAgentNode',
    ]);
```

Then, in the test `'sends the Better Solutions prompt and the get_services tool to OpenRouter'`, change the call selector so it picks the agent call (the one carrying tools) rather than the first OpenRouter call. Replace:

```typescript
    const orCall = calls.find(([u]) =>
      urlOf(u).startsWith('https://openrouter.ai/'),
    );
    const body = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
```

with:

```typescript
    const agentCall = calls.find(([u, init]) => {
      if (!urlOf(u).startsWith('https://openrouter.ai/')) return false;
      const parsed = JSON.parse(init.body as string) as {
        tools?: unknown[];
      };
      return Array.isArray(parsed.tools) && parsed.tools.length > 0;
    });
    const body = JSON.parse(agentCall![1].body as string) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- conversation.workflow`
Expected: FAIL — trace has only `['AiAgentNode']` (router not wired yet); the new trace assertion does not match.

- [ ] **Step 3: Update the workflow implementation**

Rewrite `src/app/conversation/conversation.workflow.ts`. Remove the inline `SYSTEM_PROMPT` constant entirely and route per turn:

```typescript
import {
  AiAgentNode,
  ClassifyNode,
  OpenRouterChatModel,
  PgChatMemory,
  type ChatMessage,
  type WorkflowFn,
} from '../../engine';
import { appConfig } from '../config';
import { stripMarkdown } from '../strip-markdown';
import { buildSystemPrompt, STAGE_OPTIONS } from './prompt';
import { CreateOrderTool } from '../tools/create-order.tool';
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

export interface ConversationInput {
  sessionId: string;
  chatExtId: number;
  text: string;
}

export interface ConversationOutput {
  reply: string; // final plain-text reply (markdown stripped)
  messages: ChatMessage[]; // clean turn to commit to memory after delivery
}

// The channel-agnostic business core: classify the turn's stage, run the sales
// agent with only that stage's instructions, and return its reply plus the
// clean turn to persist. Does NOT send and does NOT append memory — the channel
// commits after a successful delivery.
export const conversationWorkflow: WorkflowFn<
  ConversationInput,
  ConversationOutput
> = async function conversationWorkflow(input, wf) {
  const memory = new PgChatMemory({ sessionId: input.sessionId });
  const history = await memory.load();
  const chatModel = new OpenRouterChatModel({
    apiKey: appConfig.openRouterApiKey,
    model: appConfig.openRouterModel,
  });

  const { label: stage } = await wf.run(ClassifyNode, {
    input: input.text,
    history,
    options: STAGE_OPTIONS,
    chatModel,
  });

  const agent = await wf.run(AiAgentNode, {
    input: input.text,
    systemPrompt: buildSystemPrompt(stage),
    chatModel,
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

Note: `memory.load()` is called here for the classifier and `AiAgentNode` also loads it internally (it owns its history) — a small, accepted double-load. `chatModel` is shared by both calls.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm test -- conversation.workflow`
Expected: PASS (3 tests). The classify OpenRouter call returns the fake `'agent reply'`, which matches no label, so `ClassifyNode` falls back to `discovery`; the agent call still carries the `Better Solutions` prompt and `get_services` tool.

- [ ] **Step 5: Run the full unit suite, build, and lint**

Run: `pnpm test`
Expected: all suites PASS.

Run: `pnpm build`
Expected: succeeds.

Run: `pnpm lint`
Expected: no errors (note: lint auto-fixes, so it may modify formatting — restage if so).

- [ ] **Step 6: Commit**

```bash
git add src/app/conversation/conversation.workflow.ts src/app/conversation/conversation.workflow.spec.ts
git commit -m "feat(app): route each turn to one stage prompt via ClassifyNode"
```

---

## Self-Review

**Spec coverage:**
- `ClassifyNode` (generic engine node, input/output, fallback to `options[0]`, history window) → Task 1. ✓
- Export from `src/engine/index.ts` → Task 1, Step 5. ✓
- Prompt split into `CORE` + `STAGE_BLOCKS` (6 stages) → Task 2. ✓
- `STAGE_OPTIONS` with discovery first as fallback → Task 2. ✓
- `buildSystemPrompt` pure function, unknown → discovery → Task 2. ✓
- Workflow wiring: load history once, classify, compose prompt, share chatModel → Task 3. ✓
- Router context = recent history window; fallback = discovery → Tasks 1 & 2. ✓
- Tracing: classify recorded as a trace step → verified by the updated trace assertion in Task 3. ✓
- Code guards unchanged (`stripMarkdown`, `ChunkMessageNode`) → workflow keeps `stripMarkdown`; chunking untouched. ✓
- Tests, no live runs → all steps use `pnpm test`/`pnpm build`. ✓

**Placeholder scan:** No TBD/TODO; all code shown in full, including both prompt module and full test bodies. ✓

**Type consistency:** `ClassifyOption`/`ClassifyInput`/`ClassifyOutput` defined in Task 1 and imported in Task 2 (`ClassifyOption`) and used in Task 3 (`STAGE_OPTIONS`). `Stage` and `buildSystemPrompt(stage: string)` defined in Task 2, used in Task 3. `label` is the `ClassifyOutput` field consumed as `stage` in Task 3. Consistent. ✓

**Out of scope (per spec):** per-stage tool-gating, cheaper router model, multi-agent handoffs, deterministic foreign-script filter — none included. ✓
