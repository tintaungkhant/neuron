# Token Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture LLM token usage per node and per workflow, surface it on the trace, and persist the workflow total on the `executions` row.

**Architecture:** LLM callers (OpenRouter chat model, Gemini read-media node) return a `TokenUsage`. `AiAgentNode` sums usage across its turn. The trace formatter lifts each node's `usage` onto its trace step (same convention as `toolSteps`) and sums a per-workflow total recursively. `ExecutionStore` persists the workflow total to three new integer columns.

**Tech Stack:** NestJS 11, TypeScript (nodenext), Drizzle ORM + `pg`, Jest. Package manager **pnpm**.

**Conventions for the implementer:**
- Run a single spec with `pnpm test -- <pattern>` (e.g. `pnpm test -- trace-format`).
- Engine code (`src/engine/`) imports nothing from `src/app/` and reads no env. Keep it that way.
- `TokenUsage` fields are always camelCase (`promptTokens`, `completionTokens`, `totalTokens`). Snake_case only appears when parsing raw provider JSON.
- Usage is **optional everywhere** — when a provider omits it, the field is `undefined`, never a zero-filled object. Only `sumTokens`/`executions` columns coerce absence to `0`.

---

## File Structure

- `src/engine/trace.ts` — add `TokenUsage` interface; add `usage?` to `TraceStep`. (modify)
- `src/engine/ai/chat-model.ts` — add `usage?: TokenUsage` to `ChatCompletionResult`. (modify)
- `src/engine/nodes/ai/openrouter-chat-model.ts` — parse `usage` from response. (modify)
- `src/engine/nodes/ai/agent.node.ts` — sum usage across the turn into `AiAgentOutput.usage`. (modify)
- `src/engine/nodes/gemini/read-media.node.ts` — parse `usageMetadata` into output `usage`. (modify)
- `src/engine/trace-format.ts` — lift/strip node `usage` in `enrichStep`; add `sumTokens`; annotate `formatTrace`. (modify)
- `src/engine/db/schema.ts` — three token columns on `executions`. (modify)
- `src/engine/executions/execution-store.ts` — compute + persist + expose token totals. (modify)
- `drizzle/` — generated migration SQL. (create via `pnpm db:generate`)
- Specs co-located with each file above. (modify)

---

## Task 1: TokenUsage type + ChatModel result + OpenRouter parsing

**Files:**
- Modify: `src/engine/trace.ts`
- Modify: `src/engine/ai/chat-model.ts`
- Modify: `src/engine/nodes/ai/openrouter-chat-model.ts`
- Test: `src/engine/nodes/ai/openrouter-chat-model.spec.ts`

- [ ] **Step 1: Add the `TokenUsage` type to `trace.ts`**

At the top of `src/engine/trace.ts`, above `SerializedError`, add:

```ts
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
```

- [ ] **Step 2: Add `usage` to `ChatCompletionResult`**

In `src/engine/ai/chat-model.ts`, add the import and the field:

```ts
import type { ToolSpec } from './tool';
import type { TokenUsage } from '../trace';
```

```ts
export interface ChatCompletionResult {
  message: ChatMessage; // the assistant message (may carry toolCalls)
  usage?: TokenUsage; // token counts for this call, when the provider reports them
}
```

- [ ] **Step 3: Write the failing test for OpenRouter usage parsing**

In `src/engine/nodes/ai/openrouter-chat-model.spec.ts`, update the `okResponse` helper to allow an optional `usage`, then add two tests. Replace the existing `okResponse`:

```ts
  function okResponse(message: unknown, usage?: unknown): Response {
    const body: Record<string, unknown> = { choices: [{ message }] };
    if (usage !== undefined) body.usage = usage;
    return new Response(JSON.stringify(body), { status: 200 });
  }
```

Add inside the `describe('OpenRouterChatModel', ...)` block:

```ts
  it('parses token usage from the response', async () => {
    fetchSpy.mockResolvedValue(
      okResponse(
        { role: 'assistant', content: 'hi' },
        { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      ),
    );

    const out = await model().complete({ messages: [] });

    expect(out.usage).toEqual({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
  });

  it('leaves usage undefined when the response omits it', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'hi' }));

    const out = await model().complete({ messages: [] });

    expect(out.usage).toBeUndefined();
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm test -- openrouter-chat-model`
Expected: the two new tests FAIL (`out.usage` is `undefined` for the parsing test).

- [ ] **Step 5: Implement usage parsing in OpenRouterChatModel**

In `src/engine/nodes/ai/openrouter-chat-model.ts`:

Add the import at the top:

```ts
import type { TokenUsage } from '../../trace';
```

Add a raw-usage interface near the other interfaces (after `OpenAiMessage`):

```ts
interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function fromOpenAiUsage(u: OpenAiUsage | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
}
```

Change the response type and return in `complete`:

```ts
    const json = (await res.json()) as {
      choices?: { message?: OpenAiMessage }[];
      usage?: OpenAiUsage;
    };
    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new Error('OpenRouter: no message in response');
    }
    return {
      message: fromOpenAiMessage(message),
      usage: fromOpenAiUsage(json.usage),
    };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test -- openrouter-chat-model`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add src/engine/trace.ts src/engine/ai/chat-model.ts src/engine/nodes/ai/openrouter-chat-model.ts src/engine/nodes/ai/openrouter-chat-model.spec.ts
git commit -m "feat(engine): chat model reports token usage"
```

---

## Task 2: AiAgentNode sums usage across the turn

**Files:**
- Modify: `src/engine/nodes/ai/agent.node.ts`
- Test: `src/engine/nodes/ai/agent.node.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `src/engine/nodes/ai/agent.node.spec.ts`, add a usage-aware helper near the existing `assistant`/`toolCall` helpers:

```ts
function withUsage(
  result: ChatCompletionResult,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
): ChatCompletionResult {
  return { ...result, usage };
}
```

Add a new describe block at the end of the file:

```ts
describe('AiAgentNode — token usage', () => {
  it('sums usage across every model call in the turn', async () => {
    const weather = new FakeTool('get_weather', { tempC: 21 });
    const model = new FakeChatModel([
      withUsage(
        toolCall({ id: 'c1', name: 'get_weather', arguments: { city: 'YGN' } }),
        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      ),
      withUsage(assistant('21C'), {
        promptTokens: 20,
        completionTokens: 4,
        totalTokens: 24,
      }),
    ]);

    const out = await new AiAgentNode().execute({
      input: 'weather?',
      chatModel: model,
      tools: [weather],
    });

    expect(out.usage).toEqual({
      promptTokens: 30,
      completionTokens: 9,
      totalTokens: 39,
    });
  });

  it('omits usage when no model call reported any', async () => {
    const model = new FakeChatModel([assistant('hi')]);

    const out = await new AiAgentNode().execute({
      input: 'hi',
      chatModel: model,
    });

    expect(out.usage).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- agent.node`
Expected: the two new tests FAIL (`out.usage` does not exist).

- [ ] **Step 3: Implement usage summing**

In `src/engine/nodes/ai/agent.node.ts`:

Add the import at the top:

```ts
import type { TokenUsage } from '../../trace';
```

Add `usage` to the output interface:

```ts
export interface AiAgentOutput {
  output: string; // final assistant text
  messages: ChatMessage[]; // this turn's messages: user msg + every assistant/tool msg
  toolSteps: AgentToolStep[]; // tools invoked this run, in call order, with in/out (for tracing)
  usage?: TokenUsage; // summed token usage across every model call this turn
}
```

In `execute`, declare an accumulator alongside `toolSteps` (after the `const toolSteps` line):

```ts
    let usage: TokenUsage | undefined;
```

Inside the `for` loop, right after `const res = await chatModel.complete(...)`, fold in the call's usage:

```ts
      if (res.usage) {
        usage = {
          promptTokens: (usage?.promptTokens ?? 0) + res.usage.promptTokens,
          completionTokens:
            (usage?.completionTokens ?? 0) + res.usage.completionTokens,
          totalTokens: (usage?.totalTokens ?? 0) + res.usage.totalTokens,
        };
      }
```

Add `usage` to the returned object:

```ts
    return {
      output: finalAssistant.content,
      messages: turn,
      toolSteps,
      usage,
    };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- agent.node`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/ai/agent.node.ts src/engine/nodes/ai/agent.node.spec.ts
git commit -m "feat(engine): agent sums token usage across the turn"
```

---

## Task 3: Gemini read-media returns usage

**Files:**
- Modify: `src/engine/nodes/gemini/read-media.node.ts`
- Test: `src/engine/nodes/gemini/read-media.node.spec.ts`

- [ ] **Step 1: Write the failing test**

In `src/engine/nodes/gemini/read-media.node.spec.ts`, add inside the `describe`:

```ts
  it('parses usageMetadata into usage', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'slip' }] } }],
          usageMetadata: {
            promptTokenCount: 258,
            candidatesTokenCount: 12,
            totalTokenCount: 270,
          },
        }),
        { status: 200 },
      ),
    );
    const node = new GeminiReadMediaNode();
    const out = await node.execute({
      apiKey: 'K',
      model: 'm',
      fileUri: 'u',
      mimeType: 'image/jpeg',
      prompt: 'p',
    });

    expect(out.usage).toEqual({
      promptTokens: 258,
      completionTokens: 12,
      totalTokens: 270,
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- read-media`
Expected: FAIL (`out.usage` is `undefined`).

- [ ] **Step 3: Implement usage parsing**

In `src/engine/nodes/gemini/read-media.node.ts`:

Add the import at the top:

```ts
import type { TokenUsage } from '../../trace';
```

Add `usage` to the output interface:

```ts
export interface GeminiReadMediaOutput {
  text: string;
  usage?: TokenUsage; // token counts from Gemini usageMetadata, when present
}
```

Extend the response type and add a parser. Change the `GenerateContentResponse` interface:

```ts
interface GenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function toUsage(
  m: GenerateContentResponse['usageMetadata'],
): TokenUsage | undefined {
  if (!m) return undefined;
  return {
    promptTokens: m.promptTokenCount ?? 0,
    completionTokens: m.candidatesTokenCount ?? 0,
    totalTokens: m.totalTokenCount ?? 0,
  };
}
```

Change the return at the end of `execute` from `return { text };` to:

```ts
    return { text, usage: toUsage(json.usageMetadata) };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- read-media`
Expected: PASS (the new test plus the existing three — the existing "returns joined text" test asserts `{ text: 'a bank slip' }` and its response has no `usageMetadata`, so `usage` is `undefined` and `toEqual` ignores the absent field).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/gemini/read-media.node.ts src/engine/nodes/gemini/read-media.node.spec.ts
git commit -m "feat(engine): gemini read-media reports token usage"
```

---

## Task 4: Trace records per-node usage + sumTokens

**Files:**
- Modify: `src/engine/trace.ts`
- Modify: `src/engine/trace-format.ts`
- Test: `src/engine/trace-format.spec.ts`

- [ ] **Step 1: Add `usage` to `TraceStep`**

In `src/engine/trace.ts`, add `usage?: TokenUsage;` to the `node` and `subworkflow` members of the `TraceStep` union (NOT the `tool` member — tools carry no usage). For the `node` member, place it after `children`:

```ts
  | {
      kind: 'node';
      name: string;
      input: unknown;
      output?: unknown;
      startedAt: number;
      finishedAt: number;
      status: 'ok' | 'error';
      error?: SerializedError;
      children?: TraceStep[]; // nested steps run inside this node (e.g. agent tool calls)
      usage?: TokenUsage; // token usage lifted off the node output (LLM nodes only)
    }
```

For the `subworkflow` member, add after `trace: Trace;`:

```ts
      usage?: TokenUsage; // summed token usage of the child workflow
```

- [ ] **Step 2: Write the failing tests for enrichTrace usage + sumTokens**

In `src/engine/trace-format.spec.ts`, add the `sumTokens` import:

```ts
import {
  formatTrace,
  enrichTrace,
  countSteps,
  truncateTrace,
  sumTokens,
} from './trace-format';
```

Add these tests. First, inside `describe('enrichTrace', ...)`:

```ts
  it('lifts usage off a node output onto the step and strips it', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            output: 'hi',
            messages: [],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          startedAt: 0,
          finishedAt: 100,
          status: 'ok',
        },
      ],
    };

    const step = enrichTrace(trace).steps[0];
    if (step.kind !== 'node') throw new Error('expected node');
    expect(step.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(step.output).toEqual({ output: 'hi', messages: [] });
  });

  it('sets sub-workflow step usage to the child total', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 0,
          finishedAt: 100,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 0,
            finishedAt: 100,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'AiAgentNode',
                input: {},
                output: {
                  usage: {
                    promptTokens: 7,
                    completionTokens: 2,
                    totalTokens: 9,
                  },
                },
                startedAt: 0,
                finishedAt: 100,
                status: 'ok',
              },
            ],
          },
        },
      ],
    };

    const step = enrichTrace(trace).steps[0];
    if (step.kind !== 'subworkflow') throw new Error('expected subworkflow');
    expect(step.usage).toEqual({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
  });
```

Then add a new describe block:

```ts
describe('sumTokens', () => {
  it('sums node usage and recurses into sub-workflows', () => {
    const trace: Trace = {
      workflowName: 'parent',
      startedAt: 0,
      finishedAt: 100,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
          startedAt: 0,
          finishedAt: 10,
          status: 'ok',
        },
        {
          kind: 'subworkflow',
          name: 'child',
          input: {},
          startedAt: 10,
          finishedAt: 20,
          status: 'ok',
          trace: {
            workflowName: 'child',
            startedAt: 10,
            finishedAt: 20,
            status: 'ok',
            input: {},
            steps: [
              {
                kind: 'node',
                name: 'GeminiReadMediaNode',
                input: {},
                output: {
                  usage: {
                    promptTokens: 100,
                    completionTokens: 20,
                    totalTokens: 120,
                  },
                },
                startedAt: 10,
                finishedAt: 20,
                status: 'ok',
              },
            ],
          },
        },
      ],
    };

    expect(sumTokens(enrichTrace(trace))).toEqual({
      promptTokens: 110,
      completionTokens: 25,
      totalTokens: 135,
    });
  });

  it('returns zeros for a trace with no usage', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 0,
      finishedAt: 1,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'TelegramWebhookNode',
          input: {},
          output: {},
          startedAt: 0,
          finishedAt: 1,
          status: 'ok',
        },
      ],
    };

    expect(sumTokens(trace)).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- trace-format`
Expected: FAIL — `sumTokens` is not exported; enrich does not set `step.usage`.

- [ ] **Step 4: Implement usage lift + sumTokens in `trace-format.ts`**

In `src/engine/trace-format.ts`:

Update the import line:

```ts
import type { Trace, TraceStep, TokenUsage } from './trace';
```

Add a `usage` extractor near `extractToolSteps`:

```ts
function extractUsage(output: unknown): TokenUsage | undefined {
  if (typeof output !== 'object' || output === null) return undefined;
  const u = (output as { usage?: unknown }).usage;
  if (typeof u !== 'object' || u === null) return undefined;
  const { promptTokens, completionTokens, totalTokens } = u as Record<
    string,
    unknown
  >;
  if (
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function stripUsage(output: unknown): unknown {
  if (typeof output !== 'object' || output === null) return output;
  if (!('usage' in output)) return output;
  const rest = { ...(output as Record<string, unknown>) };
  delete rest.usage;
  return rest;
}
```

Rewrite `enrichStep` to handle sub-workflow usage and node usage. Replace the whole function with:

```ts
function enrichStep(step: TraceStep): TraceStep {
  if (step.kind === 'subworkflow') {
    const trace = enrichTrace(step.trace);
    return { ...step, trace, usage: sumTokens(trace) };
  }
  if (step.kind === 'tool') return step;
  const usage = extractUsage(step.output);
  const tools = extractToolSteps(step.output);
  // Lift usage off the output (and tools, if present) so they're not stored twice.
  let output = step.output;
  if (usage) output = stripUsage(output);
  if (!tools) {
    return usage ? { ...step, output, usage } : step;
  }
  const children: TraceStep[] = tools.map((t) => ({
    kind: 'tool',
    name: t.name,
    input: t.input,
    output: t.output,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
    status: t.status,
  }));
  output = stripToolSteps(output);
  return usage
    ? { ...step, output, children, usage }
    : { ...step, output, children };
}
```

Add `sumTokens` (place it after `countSteps`):

```ts
/** Per-workflow token total: sums node-step usage plus every sub-workflow's total. */
export function sumTokens(trace: Trace): TokenUsage {
  const total: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const step of trace.steps) {
    let u: TokenUsage | undefined;
    if (step.kind === 'subworkflow') {
      u = sumTokens(step.trace);
    } else if (step.kind === 'node') {
      u = step.usage ?? extractUsage(step.output);
    }
    if (u) {
      total.promptTokens += u.promptTokens;
      total.completionTokens += u.completionTokens;
      total.totalTokens += u.totalTokens;
    }
  }
  return total;
}
```

Note: `sumTokens` reads `step.usage` when present (enriched trace) and falls back to `extractUsage(step.output)` for a raw, un-enriched trace — so it works either way.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- trace-format`
Expected: PASS (new tests plus all existing enrichTrace/truncateTrace/countSteps/formatTrace tests — the existing fixtures carry no `usage`, so behaviour is unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/engine/trace.ts src/engine/trace-format.ts src/engine/trace-format.spec.ts
git commit -m "feat(engine): trace records per-node usage and per-workflow total"
```

---

## Task 5: formatTrace token annotation

**Files:**
- Modify: `src/engine/trace-format.ts`
- Test: `src/engine/trace-format.spec.ts`

- [ ] **Step 1: Write the failing test**

In `src/engine/trace-format.spec.ts`, add inside `describe('formatTrace', ...)`:

```ts
  it('appends token counts per node and for the workflow', () => {
    const trace: Trace = {
      workflowName: 'wf',
      startedAt: 1000,
      finishedAt: 2000,
      status: 'ok',
      input: {},
      steps: [
        {
          kind: 'node',
          name: 'AiAgentNode',
          input: {},
          output: {
            output: 'hi',
            usage: { promptTokens: 30, completionTokens: 9, totalTokens: 39 },
          },
          startedAt: 1000,
          finishedAt: 2000,
          status: 'ok',
        },
      ],
    };

    expect(formatTrace(enrichTrace(trace))).toBe(
      'wf ✓ 1000ms · 39 tok\n  ai agent (1000ms · 39 tok)',
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- trace-format`
Expected: FAIL — the output has no ` · 39 tok` suffixes.

- [ ] **Step 3: Implement the annotation**

In `src/engine/trace-format.ts`:

Add a `tokens` field to the `FlowToken` interface:

```ts
interface FlowToken {
  label: string;
  ms: number;
  status: 'ok' | 'error';
  tokens?: number; // totalTokens for this node, when it reported usage
}
```

In `collect`, attach `tokens` to the node token (the `tokens.push({ label: humanize(step.name), ... })` for the non-subworkflow branch). Replace that push with:

```ts
    tokens.push({
      label: humanize(step.name),
      ms: step.finishedAt - step.startedAt,
      status: step.status,
      tokens:
        step.kind === 'node' && step.usage
          ? step.usage.totalTokens
          : undefined,
    });
```

(Leave the tool-children push unchanged — tools have no usage.)

In `formatTrace`, add the per-node suffix and the workflow suffix. Replace the `.map` callback and the `total`/`out` lines:

```ts
  const flow = collect(trace)
    .map((t) => {
      const mark = t.status === 'error' ? ' ✗' : '';
      const tok = t.tokens ? ` · ${t.tokens} tok` : '';
      return `${t.label}${mark} (${t.ms}ms${tok})`;
    })
    .join(' → ');

  const icon = trace.status === 'error' ? '✗' : '✓';
  const total = trace.finishedAt - trace.startedAt;
  const totalTokens = sumTokens(trace).totalTokens;
  const tokSuffix = totalTokens > 0 ? ` · ${totalTokens} tok` : '';
  let out = `${trace.workflowName} ${icon} ${total}ms${tokSuffix}\n  ${flow}`;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- trace-format`
Expected: PASS (new test plus existing formatTrace tests — their fixtures have no usage so no suffix is added, output unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/trace-format.ts src/engine/trace-format.spec.ts
git commit -m "feat(engine): formatTrace shows per-node and workflow token counts"
```

---

## Task 6: Persist workflow token total on executions

**Files:**
- Modify: `src/engine/db/schema.ts`
- Modify: `src/engine/executions/execution-store.ts`
- Create: migration SQL under `drizzle/` (generated)

- [ ] **Step 1: Add token columns to the `executions` schema**

In `src/engine/db/schema.ts`, add three columns to the `executions` table, after `stepCount` and before `trace`:

```ts
    stepCount: integer('step_count').notNull(), // recursive: nodes + tool children + sub-workflow steps
    tokensPrompt: integer('tokens_prompt').notNull().default(0),
    tokensCompletion: integer('tokens_completion').notNull().default(0),
    tokensTotal: integer('tokens_total').notNull().default(0),
    trace: jsonb('trace').notNull().$type<Trace>(), // full enriched trace, with node/tool in & out
```

- [ ] **Step 2: Persist and expose the totals in ExecutionStore**

In `src/engine/executions/execution-store.ts`:

Update the import from `trace-format` to include `sumTokens`:

```ts
import { enrichTrace, countSteps, truncateTrace, sumTokens } from '../trace-format';
```

Add token fields to both result interfaces:

```ts
export interface ExecutionSummary {
  id: number;
  workflowName: string;
  status: string;
  durationMs: number;
  stepCount: number;
  tokensTotal: number;
  createdAt: Date;
}
```

```ts
export interface ExecutionRecord extends ExecutionSummary {
  startedAt: Date;
  finishedAt: Date;
  tokensPrompt: number;
  tokensCompletion: number;
  trace: Trace;
}
```

In `save`, compute the totals and add them to the insert values:

```ts
  async save(trace: Trace): Promise<number> {
    const enriched = enrichTrace(trace);
    const stored = truncateTrace(enriched); // bound row size; folds already done
    const usage = sumTokens(enriched);
    const [row] = await db
      .insert(executions)
      .values({
        workflowName: enriched.workflowName,
        status: enriched.status,
        startedAt: new Date(enriched.startedAt),
        finishedAt: new Date(enriched.finishedAt),
        durationMs: enriched.finishedAt - enriched.startedAt,
        stepCount: countSteps(enriched),
        tokensPrompt: usage.promptTokens,
        tokensCompletion: usage.completionTokens,
        tokensTotal: usage.totalTokens,
        trace: stored,
      })
      .returning({ id: executions.id });
    return row.id;
  }
```

In `list`, add `tokensTotal` to the selected columns:

```ts
      .select({
        id: executions.id,
        workflowName: executions.workflowName,
        status: executions.status,
        durationMs: executions.durationMs,
        stepCount: executions.stepCount,
        tokensTotal: executions.tokensTotal,
        createdAt: executions.createdAt,
      })
```

In `get`, add the three token fields to the returned record (after `stepCount`):

```ts
    return {
      id: row.id,
      workflowName: row.workflowName,
      status: row.status,
      durationMs: row.durationMs,
      stepCount: row.stepCount,
      tokensTotal: row.tokensTotal,
      tokensPrompt: row.tokensPrompt,
      tokensCompletion: row.tokensCompletion,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      trace: row.trace,
    };
```

- [ ] **Step 3: Verify the engine still type-checks and tests pass**

Run: `pnpm test -- trace-format && pnpm build`
Expected: tests PASS; build succeeds (no type errors from the schema/store changes).

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new SQL file appears under `drizzle/` adding `tokens_prompt`, `tokens_completion`, `tokens_total` to `executions` with `DEFAULT 0 NOT NULL`. Inspect it to confirm it only touches the `executions` table.

> Do NOT run `pnpm db:migrate` — the user applies migrations and does runtime verification themselves.

- [ ] **Step 5: Commit**

```bash
git add src/engine/db/schema.ts src/engine/executions/execution-store.ts drizzle/
git commit -m "feat(engine): persist per-workflow token total on executions"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS.

- [ ] **Lint**

Run: `pnpm lint`
Expected: clean (note: lint auto-fixes, so it may modify files — re-stage if so).

- [ ] **Confirm prior commits intact**

Run: `git log --oneline -8`
Expected: the six feature commits sit on top of `b6f5ccc docs(spec): token logging design`.
