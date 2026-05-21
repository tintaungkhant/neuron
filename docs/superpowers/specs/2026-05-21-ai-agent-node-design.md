# AI Agent Node — Design

**Status:** APPROVED (2026-05-21)
**Depends on:** the code-defined workflow engine (`src/engine/`).

## Goal

Add an `AiAgentNode` to the engine: a node that runs an LLM tool-calling loop. It
takes four inputs — a payload, a chat model, a memory, and a set of tools —
modeled after n8n's AI Agent node. This round ships the node, an OpenRouter chat
model, a Postgres-backed memory, the tool *interface* (no concrete tools yet),
and an end-to-end demo wired into the `allinonedm` Telegram workflow.

## Approach

The engine's `Node<I, O>` contract is single-shot (`execute(input)`, no `ctx`,
cannot call other nodes). An agent must loop: model → maybe tools → model → …
until a final answer. To fit this into the existing engine without surgery, the
agent's three collaborators are **typed ports passed in the node's input** —
plain TypeScript interfaces, not engine `Node`s. The `AiAgentNode` calls those
objects directly inside its `execute`.

Concrete port implementations (`OpenRouterChatModel`, `PgChatMemory`) are
`@Injectable` NestJS providers. A workflow obtains them through one small new
engine method, `ctx.get(Type)`, and passes them into the agent's input.

Trade-off accepted: model/tool calls inside the loop are not individual trace
steps — the whole agent is one `ctx.run` step. Per-call tracing can be layered
in later without changing the port interfaces.

Rejected alternatives: making every collaborator an engine `Node` (memory's
load+append does not fit single-shot `Node`; agent would re-implement
`ctx.run`); making the agent a sub-workflow (more machinery, the agent stops
being a node).

## Tech Stack

- NestJS 11, TypeScript 5.7 (`nodenext`, CommonJS output), Jest 30.
- OpenRouter via **raw `fetch`** to the OpenAI-compatible
  `https://openrouter.ai/api/v1/chat/completions` endpoint. The installed
  `@openrouter/sdk` is ESM-only and has moved tool-calling to a separate
  `@openrouter/agent` package — it is **dropped** from dependencies.
- Postgres via **Drizzle ORM** (`drizzle-orm` + `pg`, dev `drizzle-kit` +
  `@types/pg`).

## File Layout

```
src/engine/ai/                      NEW — port interfaces, pure types, no DI
  chat-model.ts    ChatRole, ToolCall, ChatMessage, ChatCompletionRequest/Result, ChatModel
  tool.ts          ToolSpec, AgentTool
  memory.ts        ChatMemory
  index.ts         re-exports
src/engine/nodes/ai/                NEW — built-in implementations
  agent.node.ts             AiAgentInput, AiAgentOutput, AiAgentNode
  openrouter-chat-model.ts  OpenRouterChatModel implements ChatModel
  pg-chat-memory.ts         PgChatMemory implements ChatMemory
src/engine/db/                      NEW — Drizzle / Postgres
  schema.ts        agentMessages table
  client.ts        DRIZZLE token, Db type, createDb()
  db.module.ts     @Global DbModule providing DRIZZLE
src/engine/context.ts               MODIFY — add Context.get() + ContextImpl.get()
src/engine/engine.module.ts         MODIFY — import DbModule; provide+export AI nodes
src/engine/index.ts                 MODIFY — export AI ports + AiAgentNode
src/projects/allinonedm/workflows/telegram.workflow.ts   MODIFY — wire the agent
drizzle.config.ts                   NEW — drizzle-kit config (root)
drizzle/                            NEW — generated migration SQL (committed)
package.json                        MODIFY — deps, db:generate / db:migrate scripts
.env                                MODIFY — OPENROUTER_API_KEY, OPENROUTER_MODEL, DATABASE_URL
```

## Components

### Ports — `src/engine/ai/`

Pure interfaces. No NestJS, no DI. They define the contract every chat model,
memory, and tool must satisfy.

```ts
// chat-model.ts
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

```ts
// tool.ts
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema for the arguments object
}

export interface AgentTool extends ToolSpec {
  execute(args: Record<string, unknown>): Promise<unknown>;
}
```

```ts
// memory.ts
export interface ChatMemory {
  load(sessionId: string): Promise<ChatMessage[]>;
  append(sessionId: string, messages: ChatMessage[]): Promise<void>;
}
```

### AI Agent node — `src/engine/nodes/ai/agent.node.ts`

```ts
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
export class AiAgentNode extends Node<AiAgentInput, AiAgentOutput> { ... }
```

`execute` algorithm:

1. `history = input.memory ? await input.memory.load(payload.sessionId) : []`
2. Let `userMsg = {role:'user', content: payload.input}` and
   `turnMessages = [userMsg]` — the messages this turn produces. Build the
   working message list:
   `messages = [ {role:'system', content: systemPrompt} (if provided), ...history, userMsg ]`.
3. Loop, at most `maxSteps` iterations:
   - `res = await chatModel.complete({ messages, tools: tools?.map(toSpec) })`
   - Push `res.message` onto both `messages` and `turnMessages`.
   - If `res.message.toolCalls?.length`: for each call, find the tool by `name`
     in `tools`; if missing, throw. Run `tool.execute(call.arguments)`. Build a
     `{role:'tool', toolCallId: call.id, content: JSON.stringify(result)}`
     message, push it onto both `messages` and `turnMessages`. Continue the loop.
   - Otherwise: the assistant gave a final answer — stop.
4. If the loop ran `maxSteps` times without a final answer, throw.
5. `await input.memory?.append(payload.sessionId, turnMessages)` — the user
   message plus every assistant/tool message generated in step 3. History
   loaded in step 1 is NOT re-appended.
6. Return `{ output: lastAssistantMessage.content, messages: turnMessages }`.

`toSpec` strips an `AgentTool` down to its `ToolSpec` fields (name, description,
parameters) — the chat model only needs the schema, not `execute`.

### OpenRouter chat model — `src/engine/nodes/ai/openrouter-chat-model.ts`

```ts
@Injectable()
export class OpenRouterChatModel implements ChatModel {
  private readonly apiKey = requireEnv('OPENROUTER_API_KEY');
  private readonly model = process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: req.messages.map(toOpenAiMessage),
        tools: req.tools?.map(toOpenAiTool),
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    return { message: fromOpenAiMessage(json.choices[0].message) };
  }
}
```

Mapping between our port types and the OpenAI wire format:

- `ChatMessage` → OpenAI message. An assistant message with `toolCalls` maps to
  `{role:'assistant', content, tool_calls:[{id, type:'function',
  function:{name, arguments:<JSON string>}}]}`. A tool message maps to
  `{role:'tool', tool_call_id, content}`.
- OpenAI response → `ChatMessage`. `tool_calls[].function.arguments` arrives as a
  **JSON string** and is parsed into `ToolCall.arguments`. `content` may be
  `null` on a tool-call response — normalize to `''`.
- `ToolSpec` → `{type:'function', function:{name, description, parameters}}`.

`requireEnv` is a small local helper (throws if the env var is missing), the same
pattern already used in `allinonedm.config.ts`.

The model id comes from `OPENROUTER_MODEL`. Per-agent model selection is out of
scope this round — that is what future native model nodes (Gemini, OpenAI) are
for. The `ChatModel` port is the swap point.

### Postgres memory — Drizzle

`src/engine/db/schema.ts`:

```ts
export const agentMessages = pgTable('agent_messages', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),     // ToolCall[] | null
  toolCallId: text('tool_call_id'),   // string | null
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index('agent_messages_session_idx').on(t.sessionId, t.id)]);
```

`src/engine/db/client.ts`:

```ts
export const DRIZZLE = Symbol('DRIZZLE');
export type Db = NodePgDatabase<typeof schema>;

export function createDb(): Db {
  const pool = new Pool({ connectionString: requireEnv('DATABASE_URL') });
  return drizzle(pool, { schema });
}
```

`src/engine/db/db.module.ts` — a `@Global` module so the `DRIZZLE` token is
resolvable everywhere:

```ts
@Global()
@Module({
  providers: [{ provide: DRIZZLE, useFactory: createDb }],
  exports: [DRIZZLE],
})
export class DbModule {}
```

`src/engine/nodes/ai/pg-chat-memory.ts`:

```ts
@Injectable()
export class PgChatMemory implements ChatMemory {
  private readonly windowSize = 20;

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async load(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.id))
      .limit(this.windowSize);
    return rows.reverse().map(rowToMessage); // oldest-first
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

`load` fetches the most recent `windowSize` (20) rows, then reverses to
chronological order. `rowToMessage` drops `null` `toolCalls`/`toolCallId` so the
returned `ChatMessage` objects omit those keys when absent.

`drizzle.config.ts` at the repo root points `drizzle-kit` at the schema; the
generated SQL goes in `drizzle/` and is committed. `package.json` gains
`db:generate` (`drizzle-kit generate`) and `db:migrate` (`drizzle-kit migrate`).

### Engine change — `ctx.get`

`Context` gains one method so workflows can resolve DI providers (the port
implementations) to pass into the agent's input:

```ts
// Context interface
get<T>(type: Type<T>): T;

// ContextImpl
get<T>(type: Type<T>): T {
  return this.moduleRef.get(type, { strict: false });
}
```

`{ strict: false }` matches the existing `ContextImpl.run` lookup — it searches
the whole DI container, not just one module.

### EngineModule

```ts
@Module({
  imports: [DbModule],
  providers: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
  exports: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
})
export class EngineModule {}
```

Projects already import `EngineModule`, so `ctx.run(AiAgentNode, …)`,
`ctx.get(OpenRouterChatModel)`, and `ctx.get(PgChatMemory)` all resolve without
each project listing these providers itself.

## Data Flow

The `allinonedm` Telegram workflow after wiring:

```
TelegramWebhookNode ──▶ AiAgentNode ──▶ TelegramSendMessageNode
                            │
              chatModel ────┤  OpenRouterChatModel  (ctx.get)
              memory ───────┤  PgChatMemory         (ctx.get)
              tools ────────┘  []  (none this round)
```

```ts
export const telegramWorkflow: WorkflowFn<
  WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload>,
  void
> = async function telegramWorkflow(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  if (!parsed.text) return; // ignore non-text updates

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

`sessionId` is the Telegram chat id — memory is per-conversation.

Inside the agent, one turn: load history → send to OpenRouter → if the model
requests tools (none configured here, so this never fires yet) run them and loop
→ otherwise return the answer → append the new messages to Postgres.

## Error Handling

- `AiAgentNode` throws on: `maxSteps` exceeded without a final answer; a tool
  name the model requested that is not in `tools`.
- `OpenRouterChatModel` throws on a non-OK HTTP response (status + body in the
  message).
- `PgChatMemory` surfaces driver errors as-is.
- A tool's `execute` rejection propagates unchanged.

Every throw bubbles through `ctx.run`, which records the failing step in the
`Trace`, then `WorkflowEngine.run` wraps it in `WorkflowError` with the trace
attached. The `allinonedm` controller already wraps `engine.run` in try/catch
and logs — unchanged.

## Testing

Unit specs only, co-located `*.spec.ts`. No live database, no `start:dev` — the
user does runtime verification.

- `agent.node.spec.ts` — fakes for all three ports: a scripted `ChatModel`
  (returns a queued sequence of results), an array-backed `ChatMemory`, and a
  fake `AgentTool`. Cases:
  - plain answer, no tools — model returns a final message immediately;
  - tool loop — model returns a tool call, then a final answer; assert the tool
    ran and its result was fed back;
  - `maxSteps` exceeded — model always returns a tool call → `execute` throws;
  - unknown tool — model requests a name not in `tools` → throws;
  - memory — `load` is awaited before the first model call, `append` receives
    the user message plus this turn's new messages;
  - no memory — `memory` undefined → runs fine, `load`/`append` never called.
- `openrouter-chat-model.spec.ts` — stub global `fetch`. Assert the request body
  (model, messages and tools mapped to OpenAI shape) and the response mapping
  (`tool_calls` JSON-string arguments parsed; `null` content normalized). Assert
  a non-OK response throws.
- `pg-chat-memory.spec.ts` — pass a mock `Db` whose query-builder methods are
  Jest mocks. Assert `load` issues the ordered/limited query and reverses the
  rows; `append` maps `ChatMessage` fields to row values and no-ops on an empty
  array.
- `context.spec.ts` — extend with a case for `get()` delegating to
  `moduleRef.get` with `{ strict: false }`.

## Out of Scope

- Concrete tools — only the `AgentTool` interface and the tool-call loop ship.
- Native per-model nodes (Gemini, OpenAI) — `ChatModel` is the future swap point.
- Per-agent model selection — model id is env-driven this round.
- Streaming responses.
- Per-call (model/tool) trace steps — the agent is a single trace step.
- Memory summarization/compaction — fixed 20-message window.
