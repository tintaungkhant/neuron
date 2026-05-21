# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

An AI workflow engine on NestJS 11. Two layers exist:

- **Engine** (`src/engine/`) — runs code-defined workflows, ships built-in nodes, including an AI agent node with an OpenRouter chat model and Postgres-backed memory.
- **Projects** (`src/projects/`) — self-contained feature modules (`demo`, `allinonedm`) that wire workflows to HTTP triggers.

`AppController` / `AppService` are leftover scaffold placeholders — not used by the engine or projects. New domain code goes in dedicated Nest modules, never bolted onto `AppModule`.

Note: package name is `ai-worflow-engine` (missing the `k`). Don't "fix" it without checking — it may already be referenced elsewhere.

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

pnpm db:generate          # drizzle-kit: regenerate migration SQL from the schema
pnpm db:migrate           # drizzle-kit: apply migrations to DATABASE_URL
```

Jest unit config lives inline in `package.json` (rootDir = `src`, regex = `.*\.spec\.ts$`). E2E config is `test/jest-e2e.json`. They are separate runners — `pnpm test` does NOT pick up e2e specs.

## Environment

`.env` is loaded by `src/load-env.ts` — a manual parser, imported as a side effect at the top of `src/main.ts` and registered as a jest `setupFiles` entry. Node and jest do **not** auto-load `.env`, hence the manual loader. `drizzle.config.ts` imports it too so `pnpm db:migrate` sees `DATABASE_URL`.

Expected keys:

- `DEMO_TELEGRAM_BOT_TOKEN`, `ALLINONEDM_TELEGRAM_BOT_TOKEN` — per-project Telegram bot tokens.
- `DATABASE_URL` — Postgres connection string for chat memory.
- `OPENROUTER_API_KEY` — required by the AI agent's chat model (read lazily, only when `complete()` runs).
- `OPENROUTER_MODEL` — optional, defaults to `openai/gpt-4o-mini`.

`.env` is gitignored. Tests set the env vars they need themselves; provider constructors never read env, so importing `EngineModule` in a spec never requires real credentials.

## Architecture

### Workflow engine (`src/engine/`)

- A **workflow** is a plain async function `WorkflowFn<TIn, TOut>(input, ctx)` — not a class. `WorkflowEngine.run(wf, input)` executes one and returns `{ result, trace }`. Failures throw `WorkflowError`, which carries the `Trace`.
- `ctx` (`Context`) is how a workflow reaches the engine:
  - `ctx.run(NodeClass, input)` — resolve a node via Nest DI (`ModuleRef`, non-strict) and execute it; the call is recorded as a `Trace` step.
  - `ctx.runWorkflow(wf, input)` — run a sub-workflow with a nested trace.
  - `ctx.get(Type)` — resolve any DI provider (used to hand provider instances into a node's input).
- A **node** extends the abstract `Node<I, O>` with one method, `execute(input): Promise<O>`. Nodes are single-shot: no `ctx`, cannot call other nodes. Orchestration belongs in workflows.
- `EngineModule` provides + exports `WorkflowEngine` and the built-in AI providers (`AiAgentNode`, `OpenRouterChatModel`, `PgChatMemory`) and imports `DbModule`. Every project module imports `EngineModule`.

### Built-in nodes (`src/engine/nodes/`)

Generic, reusable nodes. `telegram/` — `TelegramWebhookNode` (parses an update), `TelegramSendMessageNode`. `ai/` — the agent and its collaborators.

### AI agent (`src/engine/nodes/ai/`, ports in `src/engine/ai/`)

- `AiAgentNode` runs an LLM tool-calling loop: load memory → build messages → call the chat model → run any requested tools and loop → return the final answer. `maxSteps` (default 6) guards runaway loops.
- The agent's three collaborators are **typed ports**, not engine `Node`s: `ChatModel`, `ChatMemory`, `AgentTool` (interfaces in `src/engine/ai/`). They are passed in the agent's input — a workflow resolves concrete implementations with `ctx.get(...)` and hands them over. This keeps `Node` single-shot while letting the agent loop.
- `OpenRouterChatModel` — `ChatModel` via raw `fetch` to OpenRouter's OpenAI-compatible endpoint (no SDK). `PgChatMemory` — `ChatMemory` over Postgres.
- **Memory stores only the final human + AI text of each turn.** Intermediate tool-call / tool-result messages are run-internal scratch — never persisted. Stored history is therefore flat `user`/`assistant` rows.

### Database (`src/engine/db/`)

Drizzle ORM + `pg`. `DbConnection` owns the `pg` `Pool`, the Drizzle handle, and closes the pool on shutdown; `DbModule` is `@Global`. Schema in `schema.ts` (`agent_messages`). Migration SQL is generated under `drizzle/` and committed; `drizzle.config.ts` is at the repo root and excluded from the Nest build.

### Projects (`src/projects/`)

Each project is a self-contained Nest module imported by `AppModule` — its own controllers, workflows, and config. There is no central project registry. A project passes `{ id, config }` into workflows via `WorkflowInput<TConfig, TPayload>`.

**Triggers are plain NestJS** — a project exposes a controller (e.g. a Telegram webhook `@Post`) that calls `WorkflowEngine.run(...)`. Triggers are not an engine abstraction; do not build a trigger/dispatcher layer.

### Misc

- Entry: `src/main.ts` imports `./load-env` first, bootstraps `AppModule`, calls `enableShutdownHooks()`, listens on `process.env.PORT ?? 3000`. No global pipes/filters/interceptors yet — add them here when introduced.
- TypeScript is `nodenext` (CommonJS output, no `"type": "module"`). `tsconfig.build.json` excludes tests and `drizzle.config.ts` from production builds.
- ESLint flat config (`eslint.config.mjs`) uses `typescript-eslint` + Prettier; lint is `--fix` by default, so running it will modify files.

Design docs live in `docs/superpowers/specs/` — the workflow engine and AI agent node designs are the authoritative reference.
