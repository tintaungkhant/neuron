# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Neuron** — an AI workflow engine on NestJS 11. Two layers exist:

- **Engine** (`src/engine/`) — runs code-defined workflows, ships built-in nodes (telegram, gemini image, AI agent), Postgres-backed chat memory, and execution-trace persistence. This is the reusable core, intended to be extracted into its own package later. **It imports nothing from `src/app/`** — that one-way dependency is what keeps extraction cheap; never break it.
- **App** (`src/app/`) — the single business application (a Telegram sales bot). Its controller(s), workflows, tools, DB schema, and config live here, wired directly into `AppModule` (`src/app.module.ts`).

Multi-project support was removed: there is one business app, not a `src/projects/<name>/` registry. The engine is extracted later, on the rule of three. Engine and app **share one Postgres database** (`DATABASE_URL`) but keep separate schemas and separate migration histories.

## Commands

Package manager is **pnpm** (lockfile + `pnpm-workspace.yaml` present). Do not use `npm` or `yarn`.

```bash
pnpm install              # install deps
pnpm start:dev            # watch-mode dev server (default port 3000, override via PORT)
pnpm build                # nest build → dist/
pnpm start:prod           # run compiled dist/main.js

pnpm lint                 # eslint --fix on src, apps, libs, test
pnpm format               # prettier write src + test

pnpm test                 # jest, unit specs (*.spec.ts co-located in src/)
pnpm test -- <pattern>    # run a single file or name pattern, e.g. pnpm test -- agent.node
pnpm test:watch
pnpm test:cov
pnpm test:e2e             # uses test/jest-e2e.json (rootDir = ./test, *.e2e-spec.ts)

pnpm db:generate          # drizzle-kit: regenerate engine migration SQL from src/engine/db/schema.ts
pnpm db:migrate           # drizzle-kit: apply engine migrations to DATABASE_URL
pnpm db:app:generate      # app migration SQL from src/app/db/schema.ts (uses drizzle.app.config.ts)
pnpm db:app:migrate       # apply app migrations to DATABASE_URL (separate tracking table __drizzle_migrations_app)
pnpm db:app:seed          # ts-node src/app/db/seed.ts — loads demo.sql into the app tables
```

Engine migrations live in `drizzle/`, app migrations in `drizzle-app/`. Both target the same `DATABASE_URL` database; the app config sets `migrations.table = __drizzle_migrations_app` so the two histories don't collide. Both drizzle configs (`drizzle.config.ts`, `drizzle.app.config.ts`) are at the repo root and excluded from the Nest build.

Jest unit config lives inline in `package.json` (rootDir = `src`, regex = `.*\.spec\.ts$`). E2E config is `test/jest-e2e.json`. They are separate runners — `pnpm test` does NOT pick up e2e specs.

## Environment

`.env` is loaded by `src/load-env.ts` — a manual parser, imported as a side effect at the top of `src/main.ts` and registered as a jest `setupFiles` entry. Node and jest do **not** auto-load `.env`, hence the manual loader. Both drizzle configs import it too so the `db:*` scripts see `DATABASE_URL`.

Expected keys:

- `DATABASE_URL` — the one Postgres connection string for everything: engine tables (`agent_messages`, `executions`) and app tables (`services`, `chats`, `orders`, `faqs`, `payment_methods`).
- `TELEGRAM_BOT_TOKEN` — the app's Telegram bot token.
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` — the conversational agent's OpenRouter credentials/model.
- `GEMINI_API_KEY`, `GEMINI_MODEL` — native Gemini (Files API) credentials for reading images.

The app's `src/app/config.ts` reads these keys (`requireEnv`) at import time into the `appConfig` singleton. `OpenRouterChatModel` never reads env — it takes `{ apiKey, model }` in its constructor, supplied from `appConfig`. `src/app/db/client.ts` reads `DATABASE_URL` directly for its own `pg` pool.

`.env` is gitignored. Tests set the env vars they need themselves; engine providers never read env, so importing `EngineModule` in a spec never requires real credentials.

## Architecture

### Workflow engine (`src/engine/`)

- A **workflow** is a plain async function `WorkflowFn<TIn, TOut>(input, wf)` — not a class. `WorkflowEngine.run(workflow, input)` executes one and returns `{ result, trace }`. Failures throw `WorkflowError`, which carries the `Trace`.
- `wf` (`Context`) is the workflow's handle to the engine:
  - `wf.run(NodeClass, input)` — resolve a node via Nest DI (`ModuleRef`, non-strict) and execute it; the call is recorded as a `Trace` step.
  - `wf.runWorkflow(subWf, input)` — run a sub-workflow with a nested trace.
  - `wf` has no DI accessor. A workflow never reaches into the container. Per-project trigger data (payload + config) is the workflow's `input`. Collaborators a node needs at call time (chat model, memory, tools) are plain classes the workflow `new`s up inline — no DI, no factories.
- A **node** extends the abstract `Node<I, O>` with one method, `execute(input): Promise<O>`. Nodes are single-shot: no `wf`, cannot call other nodes. Orchestration belongs in workflows.
- `EngineModule` provides + exports `WorkflowEngine` and `AiAgentNode`, and registers a private `DbShutdown` provider that closes the Postgres pool on app shutdown. Every project module imports `EngineModule`. `OpenRouterChatModel` and `PgChatMemory` are *not* DI providers — they are plain classes a workflow constructs inline.

### Built-in nodes (`src/engine/nodes/`)

Generic, reusable nodes. `telegram/` — `TelegramWebhookNode` (parses an update), `TelegramSendMessageNode`. `ai/` — the agent and its collaborators.

### AI agent (`src/engine/nodes/ai/`, ports in `src/engine/ai/`)

- `AiAgentNode` runs an LLM tool-calling loop: load memory → build messages → call the chat model → run any requested tools and loop → return the final answer. `maxSteps` (default 6) guards runaway loops.
- The agent's three collaborators are **typed ports**, not engine `Node`s: `ChatModel`, `ChatMemory`, `AgentTool` (interfaces in `src/engine/ai/`). They are passed in the agent's input — a workflow supplies concrete implementations and hands them over. This keeps `Node` single-shot while letting the agent loop.
- `OpenRouterChatModel` — `ChatModel` via raw `fetch` to OpenRouter's OpenAI-compatible endpoint (no SDK). Plain class: `new OpenRouterChatModel({ apiKey, model })` with values from project config — reads no env. `PgChatMemory` — `ChatMemory` over Postgres. Plain class: `new PgChatMemory({ sessionId, windowSize? })`. `sessionId` is required and owned by the memory; `load()` / `append(messages)` take no sessionId. `windowSize` defaults to 20. Resolves the singleton `db` handle internally from `src/engine/db/client.ts`.
- `AiAgentNode` input is flat: `{ input: string, systemPrompt?, chatModel, memory?, tools?, maxSteps? }`. No `payload` envelope and no `sessionId` on the agent — session identity belongs to the memory.
- **Memory stores only the final human + AI text of each turn.** Intermediate tool-call / tool-result messages are run-internal scratch — never persisted. Stored history is therefore flat `user`/`assistant` rows.

### Database (`src/engine/db/`)

Drizzle ORM + `pg`. `client.ts` constructs the `pg` `Pool` and Drizzle handle at module load and exports a singleton `db` plus an idempotent `closeDb()`. `DbShutdown` (an `@Injectable()` provider in `EngineModule`) calls `closeDb()` on `beforeApplicationShutdown` — that's the only DI plumbing the DB has. Schema in `schema.ts` (`agent_messages`, `executions`). `ExecutionStore` (an `EngineModule` provider) persists each run's enriched `Trace` as a row in `executions`; the app controller calls `executions.save(trace)` after `engine.run`. Migration SQL is generated under `drizzle/` and committed; `drizzle.config.ts` is at the repo root and excluded from the Nest build.

### App (`src/app/`)

The single business app — controllers, workflows, tools, DB, and config — wired directly into `AppModule` (`src/app.module.ts`). The workflow takes the trigger payload directly as `input` (e.g. `WorkflowFn<TelegramWebhookPayload, void>`); app config (`id`, tokens, keys) lives as a module-level singleton (`appConfig` in `src/app/config.ts`) the workflow imports.

**Triggers are plain NestJS** — the app exposes a controller (the Telegram webhook `@Post`) that calls `WorkflowEngine.run(...)`. Triggers are not an engine abstraction; do not build a trigger/dispatcher layer.

**App DB pattern:** `src/app/db/` mirrors the engine pattern — `schema.ts` (services, chats, orders, faqs, payment_methods), `client.ts` (singleton `appDb` + idempotent `closeAppDb()`, reading `DATABASE_URL` directly), `db-shutdown.ts` (`@Injectable()` `AppDbShutdown` registered in `AppModule`). App tables live in the **same database** as the engine; migrations live under `drizzle-app/`, applied via `db:app:*` using `drizzle.app.config.ts` (separate `__drizzle_migrations_app` tracking table).

**App tools:** app `AgentTool`s (e.g. `GetServicesTool`) live under `src/app/tools/`. The workflow constructs them inline (`new GetServicesTool()`) and passes them in `tools: [...]` on the agent input. Tools read from `appDb`, not the engine `db`.

### Misc

- Entry: `src/main.ts` imports `./load-env` first, bootstraps `AppModule`, calls `enableShutdownHooks()`, listens on `process.env.PORT ?? 3000`. No global pipes/filters/interceptors yet — add them here when introduced.
- TypeScript is `nodenext` (CommonJS output, no `"type": "module"`). `tsconfig.build.json` excludes tests and both drizzle config files (`drizzle.config.ts`, `drizzle.app.config.ts`) from production builds.
- ESLint flat config (`eslint.config.mjs`) uses `typescript-eslint` + Prettier; lint is `--fix` by default, so running it will modify files.

Design docs live in `docs/superpowers/specs/` — the workflow engine and AI agent node designs are the authoritative reference.
