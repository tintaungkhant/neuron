# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

An AI workflow engine on NestJS 11. Two layers exist:

- **Engine** (`src/engine/`) — runs code-defined workflows, ships built-in nodes, including an AI agent node with an OpenRouter chat model and Postgres-backed memory.
- **Projects** (`src/projects/`) — self-contained feature modules (currently `demo`) that wire workflows to HTTP triggers. Projects may own their own DB.

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

pnpm db:generate          # drizzle-kit: regenerate engine migration SQL from src/engine/db/schema.ts
pnpm db:migrate           # drizzle-kit: apply engine migrations to DATABASE_URL
pnpm db:demo:generate     # demo-project migration SQL from src/projects/demo/db/schema.ts (uses drizzle.demo.config.ts)
pnpm db:demo:migrate      # apply demo migrations to DEMO_DATABASE_URL
```

Jest unit config lives inline in `package.json` (rootDir = `src`, regex = `.*\.spec\.ts$`). E2E config is `test/jest-e2e.json`. They are separate runners — `pnpm test` does NOT pick up e2e specs.

## Environment

`.env` is loaded by `src/load-env.ts` — a manual parser, imported as a side effect at the top of `src/main.ts` and registered as a jest `setupFiles` entry. Node and jest do **not** auto-load `.env`, hence the manual loader. `drizzle.config.ts` imports it too so `pnpm db:migrate` sees `DATABASE_URL`.

Expected keys:

- `DATABASE_URL` — Postgres connection string for engine chat memory (`agent_messages` table).
- `DEMO_TELEGRAM_BOT_TOKEN` — demo project's Telegram bot token.
- `DEMO_OPENROUTER_API_KEY`, `DEMO_OPENROUTER_MODEL` — demo project's OpenRouter credentials/model.
- `DEMO_DATABASE_URL` — Postgres connection string for the demo project's own DB (`services` table). Same host as `DATABASE_URL`, different database.

Env is per-project: each project's `*.config.ts` reads its own keys (`requireEnv`) at import time and packs them into the project config object. `OpenRouterChatModel` never reads env — it takes `{ apiKey, model }` in its constructor, supplied from project config.

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

Drizzle ORM + `pg`. `client.ts` constructs the `pg` `Pool` and Drizzle handle at module load and exports a singleton `db` plus an idempotent `closeDb()`. `DbShutdown` (an `@Injectable()` provider in `EngineModule`) calls `closeDb()` on `beforeApplicationShutdown` — that's the only DI plumbing the DB has. Schema in `schema.ts` (`agent_messages`). Migration SQL is generated under `drizzle/` and committed; `drizzle.config.ts` is at the repo root and excluded from the Nest build.

### Projects (`src/projects/`)

Each project is a self-contained Nest module imported by `AppModule` — its own controllers, workflows, tools, DB, and config. There is no central project registry. The workflow takes the trigger payload directly as `input` (e.g. `WorkflowFn<TelegramWebhookPayload, void>`); per-project config (`id`, tokens, keys, db URL) lives as a module-level singleton (`demoConfig`) the workflow imports.

**Triggers are plain NestJS** — a project exposes a controller (e.g. a Telegram webhook `@Post`) that calls `WorkflowEngine.run(...)`. Triggers are not an engine abstraction; do not build a trigger/dispatcher layer.

**Project-owned DB pattern (demo):** `src/projects/demo/db/` mirrors the engine pattern — `schema.ts` (services table), `client.ts` (singleton `demoDb` + idempotent `closeDemoDb()`), `db-shutdown.ts` (`@Injectable()` `BeforeApplicationShutdown` provider registered in `DemoModule`). Migrations live under `drizzle-demo/`, generated/applied via the `db:demo:*` scripts using `drizzle.demo.config.ts` at the repo root (excluded from the Nest build).

**Project-owned tools:** project-specific `AgentTool`s (e.g. `GetServicesTool`) live under `src/projects/<name>/tools/`. The workflow constructs them inline (`new GetServicesTool()`) and passes them in `tools: [...]` on the agent input. Tools read from the project's own DB singleton, not the engine DB.

### Misc

- Entry: `src/main.ts` imports `./load-env` first, bootstraps `AppModule`, calls `enableShutdownHooks()`, listens on `process.env.PORT ?? 3000`. No global pipes/filters/interceptors yet — add them here when introduced.
- TypeScript is `nodenext` (CommonJS output, no `"type": "module"`). `tsconfig.build.json` excludes tests and both drizzle config files (`drizzle.config.ts`, `drizzle.demo.config.ts`) from production builds.
- ESLint flat config (`eslint.config.mjs`) uses `typescript-eslint` + Prettier; lint is `--fix` by default, so running it will modify files.

Design docs live in `docs/superpowers/specs/` — the workflow engine and AI agent node designs are the authoritative reference.
