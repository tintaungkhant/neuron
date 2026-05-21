# AI Agent Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AiAgentNode` to the workflow engine that runs an LLM tool-calling loop, fed by four inputs — payload, chat model, memory, tools — with an OpenRouter chat model and a Postgres-backed memory.

**Architecture:** The engine's `Node<I,O>` is single-shot. The agent's three collaborators (`ChatModel`, `ChatMemory`, `AgentTool`) are typed *ports* — plain interfaces passed in the node's input. `AiAgentNode` calls them directly inside `execute`. Concrete implementations are `@Injectable` providers a workflow resolves via a new `ctx.get(Type)` method. The full design is in `docs/superpowers/specs/2026-05-21-ai-agent-node-design.md`.

**Tech Stack:** NestJS 11, TypeScript 5.7 (`nodenext`, CommonJS), Jest 30, raw `fetch` to OpenRouter's OpenAI-compatible endpoint, Drizzle ORM + `pg` for Postgres.

**Conventions:**
- Package manager is **pnpm** — never `npm`/`yarn`.
- Unit specs are `*.spec.ts` co-located in `src/`. Run one with `pnpm test -- <pattern>`.
- Do **not** run `pnpm start:dev` or any live database/integration test — the repo owner does runtime verification. Verification here is `pnpm test` + `pnpm build` only.
- Work on the current branch (`feat/nodes/telegram`). Each task ends with a commit. Never `git reset --hard`, never force-push.

---

### Task 1: AI port interfaces

Pure TypeScript interfaces — the contract every chat model, tool, and memory satisfies. No NestJS, no DI, no tests (types only; `pnpm build` is the check).

**Files:**
- Create: `src/engine/ai/tool.ts`
- Create: `src/engine/ai/chat-model.ts`
- Create: `src/engine/ai/memory.ts`
- Create: `src/engine/ai/index.ts`

- [ ] **Step 1: Create `src/engine/ai/tool.ts`**

```ts
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments object
}

export interface AgentTool extends ToolSpec {
  execute(args: Record<string, unknown>): Promise<unknown>;
}
```

- [ ] **Step 2: Create `src/engine/ai/chat-model.ts`**

```ts
import type { ToolSpec } from './tool';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[]; // present on an assistant message requesting tools
  toolCallId?: string;    // present on a tool-result message: the call it answers
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
}

export interface ChatCompletionResult {
  message: ChatMessage; // the assistant message (may carry toolCalls)
}

export interface ChatModel {
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
```

- [ ] **Step 3: Create `src/engine/ai/memory.ts`**

```ts
import type { ChatMessage } from './chat-model';

export interface ChatMemory {
  load(sessionId: string): Promise<ChatMessage[]>;
  append(sessionId: string, messages: ChatMessage[]): Promise<void>;
}
```

- [ ] **Step 4: Create `src/engine/ai/index.ts`**

```ts
export type { ToolSpec, AgentTool } from './tool';
export type {
  ChatRole,
  ToolCall,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatModel,
} from './chat-model';
export type { ChatMemory } from './memory';
```

- [ ] **Step 5: Verify the project compiles**

Run: `pnpm build`
Expected: build succeeds, no errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai/
git commit -m "feat(engine): add AI agent port interfaces"
```

---

### Task 2: `ctx.get` engine method

Workflows must resolve DI providers (the port implementations) to pass into the agent's input. Add one method to `Context`.

**Files:**
- Modify: `src/engine/context.ts`
- Test: `src/engine/context.spec.ts`

- [ ] **Step 1: Add the failing test**

Append this `describe` block to the end of `src/engine/context.spec.ts`:

```ts
describe('ContextImpl.get', () => {
  it('resolves a provider via ModuleRef with strict:false', () => {
    class SomeService {}
    const instance = new SomeService();
    const get = jest.fn().mockReturnValue(instance);
    const { ctx } = makeCtxWithRef({ get });

    const resolved = ctx.get(SomeService);

    expect(resolved).toBe(instance);
    expect(get).toHaveBeenCalledWith(SomeService, { strict: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- context`
Expected: FAIL — `ctx.get is not a function` (the method does not exist yet).

- [ ] **Step 3: Add `get` to the `Context` interface**

In `src/engine/context.ts`, change the `Context` interface to add a third method:

```ts
export interface Context {
  run<I, O>(node: Type<Node<I, O>>, input: I): Promise<O>;

  runWorkflow<TIn, TOut>(wf: WorkflowFn<TIn, TOut>, input: TIn): Promise<TOut>;

  get<T>(type: Type<T>): T;
}
```

- [ ] **Step 4: Implement `get` on `ContextImpl`**

In `src/engine/context.ts`, add this method to the `ContextImpl` class (place it right after the constructor, before `run`):

```ts
  get<T>(type: Type<T>): T {
    return this.moduleRef.get(type, { strict: false });
  }
```

`Type` is already imported at the top of the file (`import type { Type } from '@nestjs/common';`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- context`
Expected: PASS — all `ContextImpl` tests green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/context.ts src/engine/context.spec.ts
git commit -m "feat(engine): add ctx.get for resolving DI providers in workflows"
```

---

### Task 3: AiAgentNode — core (no tools)

The agent node, first cut: load memory, build messages, one model call, persist the turn. Tool handling is added in Task 4. The `AiAgentInput`/`AiAgentOutput` interfaces are written in full now (including `tools` and `maxSteps`) so they do not change in Task 4.

**Files:**
- Create: `src/engine/nodes/ai/agent.node.ts`
- Test: `src/engine/nodes/ai/agent.node.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/engine/nodes/ai/agent.node.spec.ts`:

```ts
import { AiAgentNode } from './agent.node';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
} from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';

class FakeChatModel implements ChatModel {
  readonly calls: ChatCompletionRequest[] = [];
  constructor(private readonly results: ChatCompletionResult[]) {}
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.calls.push(req);
    const next = this.results.shift();
    if (!next) throw new Error('FakeChatModel: no scripted result');
    return Promise.resolve(next);
  }
}

class FakeMemory implements ChatMemory {
  readonly loaded: string[] = [];
  readonly appended: { sessionId: string; messages: ChatMessage[] }[] = [];
  constructor(private readonly history: ChatMessage[] = []) {}
  load(sessionId: string): Promise<ChatMessage[]> {
    this.loaded.push(sessionId);
    return Promise.resolve(this.history);
  }
  append(sessionId: string, messages: ChatMessage[]): Promise<void> {
    this.appended.push({ sessionId, messages });
    return Promise.resolve();
  }
}

function assistant(content: string): ChatCompletionResult {
  return { message: { role: 'assistant', content } };
}

describe('AiAgentNode — core', () => {
  it('returns the assistant answer for a plain completion', async () => {
    const model = new FakeChatModel([assistant('hello there')]);

    const out = await new AiAgentNode().execute({
      payload: { input: 'hi', sessionId: 's1' },
      chatModel: model,
    });

    expect(out.output).toBe('hello there');
    expect(model.calls).toHaveLength(1);
  });

  it('sends the system prompt then the user message', async () => {
    const model = new FakeChatModel([assistant('ok')]);

    await new AiAgentNode().execute({
      payload: { input: 'question', sessionId: 's1' },
      systemPrompt: 'be brief',
      chatModel: model,
    });

    expect(model.calls[0].messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('loads history before the call and appends the turn after', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
    ];
    const memory = new FakeMemory(history);
    const model = new FakeChatModel([assistant('final')]);

    const out = await new AiAgentNode().execute({
      payload: { input: 'now', sessionId: 'chat-9' },
      chatModel: model,
      memory,
    });

    expect(memory.loaded).toEqual(['chat-9']);
    expect(model.calls[0].messages).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'now' },
    ]);
    expect(memory.appended).toEqual([
      {
        sessionId: 'chat-9',
        messages: [
          { role: 'user', content: 'now' },
          { role: 'assistant', content: 'final' },
        ],
      },
    ]);
    expect(out.messages).toEqual([
      { role: 'user', content: 'now' },
      { role: 'assistant', content: 'final' },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- agent.node`
Expected: FAIL — cannot find module `./agent.node`.

- [ ] **Step 3: Implement the core agent node**

Create `src/engine/nodes/ai/agent.node.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool } from '../../ai/tool';

export interface AiAgentInput {
  payload: { input: string; sessionId: string };
  systemPrompt?: string;
  chatModel: ChatModel;
  memory?: ChatMemory;
  tools?: AgentTool[];
  maxSteps?: number; // default 6 — loop guard against runaway tool calls
}

export interface AiAgentOutput {
  output: string;          // final assistant text
  messages: ChatMessage[]; // this turn's messages: user msg + every assistant/tool msg
}

@Injectable()
export class AiAgentNode extends Node<AiAgentInput, AiAgentOutput> {
  async execute(input: AiAgentInput): Promise<AiAgentOutput> {
    const { payload, systemPrompt, chatModel, memory } = input;

    const history = memory ? await memory.load(payload.sessionId) : [];
    const userMsg: ChatMessage = { role: 'user', content: payload.input };
    const turnMessages: ChatMessage[] = [userMsg];

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...history, userMsg);

    const res = await chatModel.complete({ messages });
    messages.push(res.message);
    turnMessages.push(res.message);

    if (memory) {
      await memory.append(payload.sessionId, turnMessages);
    }

    return { output: res.message.content, messages: turnMessages };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- agent.node`
Expected: PASS — all 3 `AiAgentNode — core` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/ai/agent.node.ts src/engine/nodes/ai/agent.node.spec.ts
git commit -m "feat(engine): add AiAgentNode core completion loop"
```

---

### Task 4: AiAgentNode — tool loop + guards

Replace the single model call with the bounded tool-calling loop: run requested tools, feed results back, stop on a final answer, guard with `maxSteps`, throw on an unknown tool.

**Files:**
- Modify: `src/engine/nodes/ai/agent.node.ts`
- Test: `src/engine/nodes/ai/agent.node.spec.ts`

- [ ] **Step 1: Add the failing tests**

Add these helpers and a new `describe` block to `src/engine/nodes/ai/agent.node.spec.ts`. Put the `import` additions with the existing imports, the `FakeTool` class next to `FakeChatModel`, and the `toolCall` helper next to `assistant`. Add the new `import type` for `AgentTool`:

```ts
import type { AgentTool } from '../../ai/tool';
```

```ts
class FakeTool implements AgentTool {
  readonly calls: Record<string, unknown>[] = [];
  constructor(
    public readonly name: string,
    private readonly result: unknown,
    public readonly description = 'a fake tool',
    public readonly parameters: Record<string, unknown> = {
      type: 'object',
      properties: {},
    },
  ) {}
  execute(args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(args);
    return Promise.resolve(this.result);
  }
}

function toolCall(
  ...calls: { id: string; name: string; arguments: Record<string, unknown> }[]
): ChatCompletionResult {
  return { message: { role: 'assistant', content: '', toolCalls: calls } };
}
```

```ts
describe('AiAgentNode — tools', () => {
  it('runs a requested tool and feeds the result back to the model', async () => {
    const weather = new FakeTool('get_weather', { tempC: 21 });
    const model = new FakeChatModel([
      toolCall({
        id: 'call-1',
        name: 'get_weather',
        arguments: { city: 'Yangon' },
      }),
      assistant('It is 21C in Yangon.'),
    ]);

    const out = await new AiAgentNode().execute({
      payload: { input: 'weather?', sessionId: 's' },
      chatModel: model,
      tools: [weather],
    });

    expect(weather.calls).toEqual([{ city: 'Yangon' }]);
    expect(out.output).toBe('It is 21C in Yangon.');
    expect(model.calls[0].tools).toEqual([
      {
        name: 'get_weather',
        description: 'a fake tool',
        parameters: { type: 'object', properties: {} },
      },
    ]);
    expect(model.calls[1].messages).toContainEqual({
      role: 'tool',
      toolCallId: 'call-1',
      content: JSON.stringify({ tempC: 21 }),
    });
  });

  it('throws when the model keeps calling tools past maxSteps', async () => {
    const spin = new FakeTool('spin', 'again');
    const model = new FakeChatModel(
      Array.from({ length: 10 }, () =>
        toolCall({ id: 'c', name: 'spin', arguments: {} }),
      ),
    );

    await expect(
      new AiAgentNode().execute({
        payload: { input: 'go', sessionId: 's' },
        chatModel: model,
        tools: [spin],
        maxSteps: 3,
      }),
    ).rejects.toThrow(/exceeded maxSteps \(3\)/);
  });

  it('throws when the model requests a tool that is not registered', async () => {
    const model = new FakeChatModel([
      toolCall({ id: 'c', name: 'mystery', arguments: {} }),
    ]);

    await expect(
      new AiAgentNode().execute({
        payload: { input: 'go', sessionId: 's' },
        chatModel: model,
        tools: [],
      }),
    ).rejects.toThrow(/unknown tool "mystery"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- agent.node`
Expected: FAIL — the new tests fail (no tool loop yet); the 3 core tests still pass.

- [ ] **Step 3: Replace `execute` with the tool loop**

In `src/engine/nodes/ai/agent.node.ts`, change the imports line for the tool type to also bring in `ToolSpec`:

```ts
import type { AgentTool, ToolSpec } from '../../ai/tool';
```

Then replace the entire `execute` method body with:

```ts
  async execute(input: AiAgentInput): Promise<AiAgentOutput> {
    const { payload, systemPrompt, chatModel, memory, tools } = input;
    const maxSteps = input.maxSteps ?? 6;

    const history = memory ? await memory.load(payload.sessionId) : [];
    const userMsg: ChatMessage = { role: 'user', content: payload.input };
    const turnMessages: ChatMessage[] = [userMsg];

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...history, userMsg);

    const toolSpecs: ToolSpec[] | undefined = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let answer: string | undefined;

    for (let step = 0; step < maxSteps; step++) {
      const res = await chatModel.complete({ messages, tools: toolSpecs });
      const assistantMsg = res.message;
      messages.push(assistantMsg);
      turnMessages.push(assistantMsg);

      if (!assistantMsg.toolCalls?.length) {
        answer = assistantMsg.content;
        break;
      }

      for (const call of assistantMsg.toolCalls) {
        const tool = tools?.find((t) => t.name === call.name);
        if (!tool) {
          throw new Error(`AiAgentNode: unknown tool "${call.name}"`);
        }
        const result = await tool.execute(call.arguments);
        const toolMsg: ChatMessage = {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result),
        };
        messages.push(toolMsg);
        turnMessages.push(toolMsg);
      }
    }

    if (answer === undefined) {
      throw new Error(
        `AiAgentNode: exceeded maxSteps (${maxSteps}) without a final answer`,
      );
    }

    if (memory) {
      await memory.append(payload.sessionId, turnMessages);
    }

    return { output: answer, messages: turnMessages };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- agent.node`
Expected: PASS — all 6 `AiAgentNode` tests green (3 core + 3 tools).

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/ai/agent.node.ts src/engine/nodes/ai/agent.node.spec.ts
git commit -m "feat(engine): add AiAgentNode tool-calling loop and guards"
```

---

### Task 5: OpenRouter chat model

A `ChatModel` implementation that calls OpenRouter's OpenAI-compatible endpoint with raw `fetch`. Drop the now-unused `@openrouter/sdk` dependency.

**Files:**
- Create: `src/engine/nodes/ai/openrouter-chat-model.ts`
- Test: `src/engine/nodes/ai/openrouter-chat-model.spec.ts`
- Modify: `package.json` (remove `@openrouter/sdk`)

- [ ] **Step 1: Write the failing test file**

Create `src/engine/nodes/ai/openrouter-chat-model.spec.ts`:

```ts
import { OpenRouterChatModel } from './openrouter-chat-model';
import type { ChatCompletionRequest } from '../../ai/chat-model';

describe('OpenRouterChatModel', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  function okResponse(message: unknown): Response {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
    });
  }

  it('POSTs messages and tools mapped to the OpenAI shape', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'hi' }));
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
    const req: ChatCompletionRequest = {
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: { q: 'x' } }],
        },
        { role: 'tool', toolCallId: 'c1', content: '{"r":1}' },
      ],
      tools: [
        { name: 'lookup', description: 'find', parameters: { type: 'object' } },
      ],
    };

    await new OpenRouterChatModel().complete(req);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"x"}' },
          },
        ],
      },
      { role: 'tool', content: '{"r":1}', tool_call_id: 'c1' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'find',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('parses a tool-call response, JSON-decoding the arguments string', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-9',
            type: 'function',
            function: { name: 'get_time', arguments: '{"tz":"UTC"}' },
          },
        ],
      }),
    );

    const out = await new OpenRouterChatModel().complete({ messages: [] });

    expect(out.message).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-9', name: 'get_time', arguments: { tz: 'UTC' } }],
    });
  });

  it('throws when OpenRouter returns a non-OK status', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(
      new OpenRouterChatModel().complete({ messages: [] }),
    ).rejects.toThrow(/OpenRouter 429: rate limited/);
  });

  it('uses the default model when OPENROUTER_MODEL is unset', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'x' }));

    await new OpenRouterChatModel().complete({ messages: [] });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.model).toBe('openai/gpt-4o-mini');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- openrouter-chat-model`
Expected: FAIL — cannot find module `./openrouter-chat-model`.

- [ ] **Step 3: Implement the OpenRouter chat model**

Create `src/engine/nodes/ai/openrouter-chat-model.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
  ToolCall,
} from '../../ai/chat-model';
import type { ToolSpec } from '../../ai/tool';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function toOpenAiMessage(m: ChatMessage): OpenAiMessage {
  const out: OpenAiMessage = { role: m.role, content: m.content };
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    }));
  }
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

function fromOpenAiMessage(m: OpenAiMessage): ChatMessage {
  const out: ChatMessage = {
    role: m.role as ChatMessage['role'],
    content: m.content ?? '',
  };
  if (m.tool_calls?.length) {
    out.toolCalls = m.tool_calls.map<ToolCall>((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: JSON.parse(c.function.arguments || '{}') as Record<
        string,
        unknown
      >,
    }));
  }
  if (m.tool_call_id) out.toolCallId = m.tool_call_id;
  return out;
}

function toOpenAiTool(spec: ToolSpec) {
  return {
    type: 'function' as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  };
}

@Injectable()
export class OpenRouterChatModel implements ChatModel {
  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const apiKey = requireEnv('OPENROUTER_API_KEY');
    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: req.messages.map(toOpenAiMessage),
        tools: req.tools?.map(toOpenAiTool),
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices: { message: OpenAiMessage }[];
    };
    return { message: fromOpenAiMessage(json.choices[0].message) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- openrouter-chat-model`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Remove the unused `@openrouter/sdk` dependency**

Run: `pnpm remove @openrouter/sdk`
Expected: `package.json` and `pnpm-lock.yaml` updated; `@openrouter/sdk` gone from `dependencies`.

- [ ] **Step 6: Verify the build still passes**

Run: `pnpm build`
Expected: build succeeds (nothing imported `@openrouter/sdk`).

- [ ] **Step 7: Commit**

```bash
git add src/engine/nodes/ai/openrouter-chat-model.ts src/engine/nodes/ai/openrouter-chat-model.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(engine): add OpenRouter chat model, drop unused @openrouter/sdk"
```

---

### Task 6: Drizzle Postgres layer

Install Drizzle + `pg`, define the `agent_messages` table, the DB client, a `@Global` `DbModule`, the drizzle-kit config, and generate the migration SQL. No unit tests — verification is `pnpm build` plus an offline migration generation.

**Files:**
- Create: `src/engine/db/schema.ts`
- Create: `src/engine/db/client.ts`
- Create: `src/engine/db/db.module.ts`
- Create: `drizzle.config.ts` (repo root)
- Create: `drizzle/` (generated migration — committed)
- Modify: `package.json` (deps + `db:generate`/`db:migrate` scripts)
- Modify: `tsconfig.build.json` (exclude `drizzle.config.ts`)

- [ ] **Step 1: Install dependencies**

Run: `pnpm add drizzle-orm pg`
Then: `pnpm add -D drizzle-kit @types/pg`
Expected: all four packages added to `package.json`.

- [ ] **Step 2: Create the schema — `src/engine/db/schema.ts`**

```ts
import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { ToolCall } from '../ai/chat-model';

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls').$type<ToolCall[]>(),
    toolCallId: text('tool_call_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('agent_messages_session_idx').on(t.sessionId, t.id)],
);
```

- [ ] **Step 3: Create the client — `src/engine/db/client.ts`**

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');

export type Db = NodePgDatabase<typeof schema>;

export function createDb(): Db {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool, { schema });
}
```

`Pool` construction is lazy — it does not connect until the first query — so a missing `DATABASE_URL` does not break DI or specs that never query.

- [ ] **Step 4: Create the module — `src/engine/db/db.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { createDb, DRIZZLE } from './client';

@Global()
@Module({
  providers: [{ provide: DRIZZLE, useFactory: createDb }],
  exports: [DRIZZLE],
})
export class DbModule {}
```

- [ ] **Step 5: Create the drizzle-kit config — `drizzle.config.ts` at the repo root**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/engine/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

- [ ] **Step 6: Add db scripts to `package.json`**

In the `"scripts"` block of `package.json`, add these two entries (after `"test:e2e"`):

```json
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 7: Exclude `drizzle.config.ts` from the Nest build**

In `tsconfig.build.json`, add `"drizzle.config.ts"` to the `exclude` array so the config file is not emitted to `dist/`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "drizzle.config.ts"]
}
```

- [ ] **Step 8: Generate the migration SQL**

Run: `pnpm db:generate`
Expected: creates `drizzle/0000_<name>.sql` (a `CREATE TABLE "agent_messages"` statement plus the index) and `drizzle/meta/`. This is offline — it reads the schema only, no database connection.

- [ ] **Step 9: Verify the build passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 10: Verify existing tests still pass**

Run: `pnpm test`
Expected: PASS — `DbModule` is not imported anywhere yet, so nothing else is affected.

- [ ] **Step 11: Commit**

```bash
git add src/engine/db/ drizzle.config.ts drizzle/ package.json pnpm-lock.yaml tsconfig.build.json
git commit -m "feat(engine): add Drizzle Postgres layer and agent_messages schema"
```

---

### Task 7: PgChatMemory

A `ChatMemory` implementation backed by the `agent_messages` table. Tests use a mock `Db` whose query-builder methods are Jest mocks — no real database.

**Files:**
- Create: `src/engine/nodes/ai/pg-chat-memory.ts`
- Test: `src/engine/nodes/ai/pg-chat-memory.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/engine/nodes/ai/pg-chat-memory.spec.ts`:

```ts
import { PgChatMemory } from './pg-chat-memory';
import type { Db } from '../../db/client';
import type { ChatMessage } from '../../ai/chat-model';

describe('PgChatMemory.load', () => {
  it('queries the session window newest-first and returns it oldest-first', async () => {
    const rows = [
      {
        id: 2,
        sessionId: 's',
        role: 'assistant',
        content: 'second',
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      },
      {
        id: 1,
        sessionId: 's',
        role: 'user',
        content: 'first',
        toolCalls: null,
        toolCallId: null,
        createdAt: new Date(),
      },
    ];
    const limit = jest.fn().mockResolvedValue(rows);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as unknown as Db;

    const out = await new PgChatMemory(db).load('s');

    expect(select).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(20);
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });

  it('maps tool fields when present', async () => {
    const rows = [
      {
        id: 1,
        sessionId: 's',
        role: 'tool',
        content: '{"r":1}',
        toolCalls: null,
        toolCallId: 'call-1',
        createdAt: new Date(),
      },
    ];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: () => Promise.resolve(rows) }),
          }),
        }),
      }),
    } as unknown as Db;

    const out = await new PgChatMemory(db).load('s');

    expect(out).toEqual([
      { role: 'tool', content: '{"r":1}', toolCallId: 'call-1' },
    ]);
  });
});

describe('PgChatMemory.append', () => {
  it('inserts each message as a row', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values });
    const db = { insert } as unknown as Db;

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'x', arguments: {} }],
      },
    ];
    await new PgChatMemory(db).append('chat-7', messages);

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith([
      {
        sessionId: 'chat-7',
        role: 'user',
        content: 'hi',
        toolCalls: null,
        toolCallId: null,
      },
      {
        sessionId: 'chat-7',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'x', arguments: {} }],
        toolCallId: null,
      },
    ]);
  });

  it('does nothing when there are no messages', async () => {
    const insert = jest.fn();
    const db = { insert } as unknown as Db;

    await new PgChatMemory(db).append('s', []);

    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- pg-chat-memory`
Expected: FAIL — cannot find module `./pg-chat-memory`.

- [ ] **Step 3: Implement `PgChatMemory`**

Create `src/engine/nodes/ai/pg-chat-memory.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { ChatMessage } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import { DRIZZLE, type Db } from '../../db/client';
import { agentMessages } from '../../db/schema';

const WINDOW_SIZE = 20;

type Row = typeof agentMessages.$inferSelect;

function rowToMessage(row: Row): ChatMessage {
  const msg: ChatMessage = {
    role: row.role as ChatMessage['role'],
    content: row.content,
  };
  if (row.toolCalls) msg.toolCalls = row.toolCalls;
  if (row.toolCallId) msg.toolCallId = row.toolCallId;
  return msg;
}

@Injectable()
export class PgChatMemory implements ChatMemory {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async load(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.id))
      .limit(WINDOW_SIZE);
    return rows.reverse().map(rowToMessage);
  }

  async append(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await this.db.insert(agentMessages).values(
      messages.map((m) => ({
        sessionId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls ?? null,
        toolCallId: m.toolCallId ?? null,
      })),
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- pg-chat-memory`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/nodes/ai/pg-chat-memory.ts src/engine/nodes/ai/pg-chat-memory.spec.ts
git commit -m "feat(engine): add Postgres-backed PgChatMemory"
```

---

### Task 8: Wire EngineModule and engine exports

Register the built-in AI providers in `EngineModule` and re-export the new public types from the engine barrel, so projects can use them.

**Files:**
- Modify: `src/engine/engine.module.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/engine.module.spec.ts` (create)

- [ ] **Step 1: Write the failing test file**

Create `src/engine/engine.module.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { EngineModule } from './engine.module';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';
import { PgChatMemory } from './nodes/ai/pg-chat-memory';

describe('EngineModule', () => {
  it('provides the engine and the built-in AI providers', async () => {
    const mod = await Test.createTestingModule({
      imports: [EngineModule],
    }).compile();

    expect(mod.get(WorkflowEngine)).toBeInstanceOf(WorkflowEngine);
    expect(mod.get(AiAgentNode)).toBeInstanceOf(AiAgentNode);
    expect(mod.get(OpenRouterChatModel)).toBeInstanceOf(OpenRouterChatModel);
    expect(mod.get(PgChatMemory)).toBeInstanceOf(PgChatMemory);

    await mod.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- engine.module`
Expected: FAIL — `mod.get(AiAgentNode)` throws (not provided by `EngineModule` yet).

- [ ] **Step 3: Update `EngineModule`**

Replace the entire contents of `src/engine/engine.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { DbModule } from './db/db.module';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';
import { PgChatMemory } from './nodes/ai/pg-chat-memory';

@Module({
  imports: [DbModule],
  providers: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
  exports: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
})
export class EngineModule {}
```

- [ ] **Step 4: Update the engine barrel `src/engine/index.ts`**

Append these exports to the end of `src/engine/index.ts`:

```ts
export { AiAgentNode } from './nodes/ai/agent.node';
export type { AiAgentInput, AiAgentOutput } from './nodes/ai/agent.node';
export { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';
export { PgChatMemory } from './nodes/ai/pg-chat-memory';
export type {
  ChatRole,
  ToolCall,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatModel,
} from './ai/chat-model';
export type { ToolSpec, AgentTool } from './ai/tool';
export type { ChatMemory } from './ai/memory';
```

- [ ] **Step 5: Run the new test to verify it passes**

Run: `pnpm test -- engine.module`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: PASS — every existing spec still green. `EngineModule` now imports `DbModule` and provides `OpenRouterChatModel`/`PgChatMemory`; their constructors do not read env or connect, so specs importing `EngineModule` (`engine.spec.ts`, `app.module.spec.ts`, `telegram-hi.workflow.spec.ts`, the demo controller spec) are unaffected.

- [ ] **Step 7: Verify the build passes**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/engine/engine.module.ts src/engine/index.ts src/engine/engine.module.spec.ts
git commit -m "feat(engine): register AI providers in EngineModule and export them"
```

---

### Task 9: Wire the agent into the allinonedm Telegram workflow

Replace the hard-coded `'hi'` reply with a real agent turn: webhook → agent → send. This is the end-to-end demo.

**Files:**
- Modify: `src/projects/allinonedm/workflows/telegram.workflow.ts`
- Test: `src/projects/allinonedm/workflows/telegram.workflow.spec.ts` (create)

- [ ] **Step 1: Write the failing test file**

Create `src/projects/allinonedm/workflows/telegram.workflow.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../../engine';
import type { ChatMemory } from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';
import { telegramWorkflow } from './telegram.workflow';

const fakeMemory: ChatMemory = {
  load: () => Promise.resolve([]),
  append: () => Promise.resolve(),
};

describe('telegramWorkflow', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramWebhookNode, TelegramSendMessageNode],
    })
      .overrideProvider(PgChatMemory)
      .useValue(fakeMemory)
      .compile();
    engine = mod.get(WorkflowEngine);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.startsWith('https://openrouter.ai/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                { message: { role: 'assistant', content: 'agent reply' } },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
    await mod.close();
  });

  it('runs webhook -> agent -> send and replies with the agent output', async () => {
    const input: WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload> = {
      project: { id: 'allinonedm', config: { telegramBotToken: 'BOTTOKEN' } },
      payload: {
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 555, type: 'private' },
          date: 1700000000,
          text: 'hello bot',
        },
      },
    };

    const { trace } = await engine.run(telegramWorkflow, input);

    expect(trace.status).toBe('ok');
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'AiAgentNode',
      'TelegramSendMessageNode',
    ]);

    const telegramCall = fetchSpy.mock.calls.find(([u]) =>
      String(u).includes('api.telegram.org'),
    );
    expect(telegramCall).toBeDefined();
    expect(
      JSON.parse((telegramCall![1] as RequestInit).body as string),
    ).toEqual({ chat_id: 555, text: 'agent reply' });
  });

  it('ignores updates with no text', async () => {
    const input: WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload> = {
      project: { id: 'allinonedm', config: { telegramBotToken: 'BOTTOKEN' } },
      payload: {
        update_id: 2,
        message: {
          message_id: 6,
          chat: { id: 1, type: 'private' },
          date: 1700000000,
        },
      },
    };

    const { trace } = await engine.run(telegramWorkflow, input);

    expect(trace.steps.map((s) => s.name)).toEqual(['TelegramWebhookNode']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- allinonedm/workflows/telegram.workflow`
Expected: FAIL — the workflow still sends `'hi'`, so the trace has 2 steps (no `AiAgentNode`) and the Telegram body text is `'hi'`.

- [ ] **Step 3: Rewrite the workflow**

Replace the entire contents of `src/projects/allinonedm/workflows/telegram.workflow.ts` with:

```ts
import {
  AiAgentNode,
  OpenRouterChatModel,
  PgChatMemory,
  type WorkflowFn,
} from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';

export const telegramWorkflow: WorkflowFn<
  WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>,
  void
> = async function telegramWorkflow(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  if (!parsed.text) return;

  const agent = await ctx.run(AiAgentNode, {
    payload: { input: parsed.text, sessionId: String(parsed.chat.id) },
    systemPrompt: 'You are a helpful assistant.',
    chatModel: ctx.get(OpenRouterChatModel),
    memory: ctx.get(PgChatMemory),
    tools: [],
  });

  await ctx.run(TelegramSendMessageNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chat.id,
    text: agent.output,
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- allinonedm/workflows/telegram.workflow`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full test suite and build**

Run: `pnpm test`
Expected: PASS — all specs green.
Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/projects/allinonedm/workflows/telegram.workflow.ts src/projects/allinonedm/workflows/telegram.workflow.spec.ts
git commit -m "feat(allinonedm): run the AI agent in the Telegram workflow"
```

---

## Runtime setup (manual — done by the repo owner, not part of implementation)

The implementation above is fully unit-tested without a live LLM or database. To run the agent for real, the repo owner must:

1. Add to the local `.env` (gitignored):
   - `OPENROUTER_API_KEY=<key>` — required by `OpenRouterChatModel`.
   - `OPENROUTER_MODEL=<model id>` — optional; defaults to `openai/gpt-4o-mini`.
   - `DATABASE_URL=postgres://...` — required by `PgChatMemory`.
2. Apply the migration to the Postgres database: `pnpm db:migrate`.
3. Start the server and exercise the Telegram webhook.

Do not perform these steps as part of executing this plan.
