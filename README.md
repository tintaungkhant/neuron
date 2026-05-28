# Neuron

A code-first AI workflow engine on NestJS 11.

Workflows are plain async functions. Nodes are single-shot units of work. The AI agent node runs an LLM tool-calling loop with pluggable chat model, memory, and tools. Projects are self-contained NestJS modules that wire workflows to HTTP triggers.

> **Status:** early. Public API is unstable, may change without deprecation.

> **Note:** typos still live in the schema (e.g. `faqs` for the FAQ table). Tracked, not yet renamed; PRs welcome once a rename pass is scoped.

---

## Why

Most agent frameworks bury control flow inside a DSL or a class hierarchy. This one keeps the workflow as a function you can read top-to-bottom, with the engine doing only what it has to: DI for nodes, tracing, error wrapping, sub-workflows. Everything else — chat model, memory, tools, triggers — is your code.

The split is deliberate:

- **Engine** (`src/engine/`) — reusable core. Workflow runner, abstract `Node`, AI agent node, telegram nodes, Postgres-backed chat memory, OpenRouter chat model.
- **Projects** (`src/projects/`) — self-contained NestJS modules that own their own controllers, workflows, tools, config, and (optionally) their own database. The bundled `demo` project is a Telegram bot for a fictional digital marketing agency.

There is no central project registry. To add a project, write a Nest module and import it in `AppModule`.

---

## Quickstart

Requires **Node 20+**, **pnpm**, and a reachable **Postgres 14+**.

```bash
pnpm install
cp .env.example .env
# fill DATABASE_URL, DEMO_DATABASE_URL, DEMO_TELEGRAM_BOT_TOKEN,
# DEMO_OPENROUTER_API_KEY, DEMO_OPENROUTER_MODEL

# Two separate databases — engine memory and demo project tables.
# Create both Postgres databases first, then:
pnpm db:migrate          # engine schema (agent_messages)
pnpm db:demo:migrate     # demo schema (services, chats, orders, faqs, payment_methods)

pnpm start:dev           # http://localhost:3000
```

Point Telegram webhook at `POST /demo/telegram/webhook` (the demo's only trigger) and message the bot.

---

## Architecture

### Workflow

```ts
type WorkflowFn<TIn, TOut> = (input: TIn, wf: Context) => Promise<TOut>;
```

`WorkflowEngine.run(workflow, input)` executes one and returns `{ result, trace }`. Failures throw `WorkflowError`, which carries the partial trace.

The `wf` handle exposes two methods and nothing else:

- `wf.run(NodeClass, input)` — resolve a node via Nest DI (non-strict), execute it, record a trace step.
- `wf.runWorkflow(subFn, input)` — run a sub-workflow with a nested trace.

A workflow never reaches into the DI container. Per-trigger data is the workflow's `input`. Collaborators the agent needs at call time (chat model, memory, tools) are plain classes the workflow `new`s up inline.

### Node

```ts
abstract class Node<I, O> {
  abstract execute(input: I): Promise<O>;
}
```

Nodes are `@Injectable()` singletons. No `wf` handle, no calling other nodes. Orchestration belongs in the workflow.

### AI agent

`AiAgentNode` runs the standard LLM tool-calling loop: load memory → build messages → call the chat model → run any tool calls → loop. `maxSteps` (default 6) guards runaway loops.

Its three collaborators are **typed ports**, not engine nodes:

```ts
interface ChatModel  { chat(messages, opts): Promise<ChatResponse> }
interface ChatMemory { load(): Promise<ChatMessage[]>; append(messages): Promise<void> }
interface AgentTool  { name; description; parameters; execute(args): Promise<unknown> }
```

The workflow constructs concretes and passes them in the agent input:

```ts
await wf.run(AiAgentNode, {
  input: parsed.text,
  systemPrompt: '...',
  chatModel: new OpenRouterChatModel({ apiKey, model }),
  memory:    new PgChatMemory({ sessionId: `demo:${chatId}` }),
  tools:     [new GetServicesTool(), new CreateOrderTool({ chatExtId: chatId })],
});
```

This keeps `Node` single-shot while letting the agent loop. Ports live in `src/engine/ai/`; implementations in `src/engine/nodes/ai/`.

**Memory persists only the final user + assistant text per turn.** Tool-call / tool-result messages are run-internal scratch.

### Database

Drizzle ORM + `pg.Pool`. The engine owns one db (chat memory), each project may own its own. Each db has:

- a `schema.ts` (Drizzle table definitions)
- a `client.ts` exporting a singleton handle and an idempotent `close*Db()`
- a `*-shutdown.ts` `@Injectable()` provider that calls `close*Db()` on `beforeApplicationShutdown`

Migrations are committed under `drizzle/` (engine) and `drizzle-demo/` (demo project). Generate with `pnpm db:generate` / `pnpm db:demo:generate`, apply with `pnpm db:migrate` / `pnpm db:demo:migrate`.

### Env loading

`.env` is loaded by `src/load-env.ts` — a small manual parser imported as a side effect at the top of `src/main.ts` and as a jest `setupFiles` entry. Node and jest do not auto-load `.env`; this is the only loader.

The engine itself reads no env. Projects read env in their own `*.config.ts` at import time and pack values into a config object. `OpenRouterChatModel` takes `{ apiKey, model }` in its constructor — supplied from project config. This makes engine code trivially testable without secrets.

---

## Repo layout

```
src/
  engine/                  # reusable core
    ai/                    # ChatModel / ChatMemory / AgentTool ports
    db/                    # engine pg pool, schema, shutdown
    nodes/
      ai/                  # AiAgentNode, OpenRouterChatModel, PgChatMemory
      telegram/            # webhook + send-message nodes
    engine.ts              # WorkflowEngine
    context.ts             # Context (the `wf` handle)
    node.ts                # abstract Node<I, O>
    workflow.ts            # WorkflowFn type
    trace.ts, errors.ts
  projects/
    demo/                  # bundled example project
      controllers/         # Telegram webhook HTTP trigger
      workflows/           # telegram-hi workflow
      tools/               # get_services, get_payment_methods, get_faqs, create_order
      db/                  # per-project pg pool + schema
      demo.config.ts       # reads DEMO_* env at import time
      demo.module.ts
drizzle/                   # engine migrations (committed)
drizzle-demo/              # demo project migrations (committed)
docs/superpowers/specs/    # authoritative design docs for engine + agent
```

`AppController` / `AppService` are leftover scaffold placeholders — not used by the engine or any project. New domain code goes in a dedicated Nest module.

---

## Adding things

### A new workflow

A workflow is a function. Drop it in `src/projects/<name>/workflows/` and call it from a controller:

```ts
export const myWorkflow: WorkflowFn<MyInput, MyOutput> =
  async function myWorkflow(input, wf) {
    const a = await wf.run(SomeNode, input.foo);
    const b = await wf.run(OtherNode, { x: a.value });
    return { result: b };
  };
```

Trigger it from a controller:

```ts
@Post('hook')
async handle(@Body() body: MyInput) {
  const { result, trace } = await this.engine.run(myWorkflow, body);
  return result;
}
```

### A new node

Extend `Node<I, O>`, mark `@Injectable()`, register in a module's `providers`. Single `execute` method. No DI inside `execute` — receive everything via `I`.

```ts
@Injectable()
export class HttpFetchNode extends Node<{ url: string }, { body: string }> {
  async execute({ url }: { url: string }) {
    const res = await fetch(url);
    return { body: await res.text() };
  }
}
```

### A new agent tool

Implement `AgentTool`. Tools are plain classes — the workflow constructs them and passes them via `tools: [...]` on the agent input. Tools may close over per-request data via their constructor (see `CreateOrderTool` taking `chatExtId`).

```ts
export class MyTool implements AgentTool {
  readonly name = 'my_tool';
  readonly description = 'When to call it. Be specific — the LLM reads this.';
  readonly parameters = {
    type: 'object',
    properties: { q: { type: 'string', description: '...' } },
    required: ['q'],
    additionalProperties: false,
  };
  async execute(args: Record<string, unknown>) {
    // do the thing, return JSON-serialisable result
  }
}
```

### A new project

Create `src/projects/<name>/`, write a `*.module.ts` that imports `EngineModule` and registers your controllers + nodes, then import that module from `AppModule`. If the project owns a database, mirror the demo's `db/` pattern (schema, client, shutdown provider, separate `drizzle.<name>.config.ts`, `db:<name>:*` scripts in `package.json`).

---

## Tests

Two separate jest configs:

```bash
pnpm test                  # unit specs, co-located *.spec.ts under src/
pnpm test -- agent.node    # single file or name pattern
pnpm test:watch
pnpm test:cov
pnpm test:e2e              # test/jest-e2e.json, *.e2e-spec.ts under test/
```

`pnpm test` does **not** pick up e2e specs. Unit config is inline in `package.json` (rootDir `src`, regex `.*\.spec\.ts$`). Both runners load `src/load-env.ts` via `setupFiles`, so specs can rely on `.env` being parsed.

The engine has no env reads, so engine specs need no real credentials. Project specs that import `demo.config.ts` need the `DEMO_*` vars set — fakes are fine for unit tests since `jest.mock` replaces the pool client and the OpenRouter `fetch`.

Conventions:

- TDD is the working mode for this repo. Failing test → minimal impl → green → commit.
- Mock module-level singletons (db client, `fetch`, `PgChatMemory`) with `jest.mock` at the top of the spec.
- Workflow specs build a real `EngineModule` `TestingModule` and call `engine.run(workflow, payload)` — they are integration-shaped, not unit-shaped.

---

## Scripts

```
pnpm install
pnpm start:dev / start / start:prod
pnpm build

pnpm lint                  # eslint --fix on src/apps/libs/test
pnpm format                # prettier write

pnpm test / test:watch / test:cov / test:e2e

pnpm db:generate           # engine migration sql ← src/engine/db/schema.ts
pnpm db:migrate            # apply to DATABASE_URL
pnpm db:demo:generate      # demo migration sql ← src/projects/demo/db/schema.ts
pnpm db:demo:migrate       # apply to DEMO_DATABASE_URL
```

Package manager is **pnpm** (lockfile + `pnpm-workspace.yaml`). Don't use `npm` or `yarn`.

---

## Design docs

The authoritative specs for the engine and AI agent node live in `docs/superpowers/specs/`. Read those before non-trivial changes to either.

---

## License

UNLICENSED in `package.json` while the API stabilises. A permissive license will land once the public surface is locked.
