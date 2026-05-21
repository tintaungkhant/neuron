# Multi-Tenant Projects — Design Spec

**Date:** 2026-05-20
**Status:** SUPERSEDED (2026-05-21) — registry-based dispatch removed; see banner below.
**Scope:** Add project (tenant) namespacing on top of the v1.1 workflow engine. Define how projects are organized, configured, routed, and wired into Nest. No DB persistence in this slice; project config sourced from `.env` with project-id prefix.

> **Structure change (2026-05-21):** the registry/dispatch layer described below was dropped in favor of full project isolation. No `ProjectRegistry`, no `PROJECT_REGISTRATIONS`, no project-agnostic trigger controllers, no `src/shared/`. Triggers (HTTP controllers, future cron) are plain NestJS — a framework concern, not the engine's. Current shape:
> ```
> src/
>   engine/
>     nodes/telegram/         # generic built-in nodes (webhook parser, send-message)
>   projects/
>     project.types.ts        # WorkflowInput<TConfig, TPayload> only
>     demo/
>       demo.module.ts        # self-contained: imports EngineModule, declares controller + node providers
>       demo.config.ts        # reads DEMO_* env
>       controllers/          # plain @Controller, hardcoded /api/demo/... prefix, injects WorkflowEngine
>       workflows/
>       nodes/                # project-specific nodes only (empty until needed)
> ```
> Each project = one self-contained Nest module imported by `AppModule`. Generic nodes live in `engine/nodes/`. The sections below are kept as historical record of the registry approach.

## Goal

The engine is shipped (`docs/superpowers/specs/2026-05-20-workflow-engine-design.md`). It executes a `WorkflowFn` and produces a `Trace`. This spec adds the layer above the engine: each project (tenant / customer) owns its own workflows, optional project-specific nodes, and config. Webhook URLs are namespaced by project id. Adding a new project should require only files inside `src/projects/<id>/` plus two small touches to the project module + registry.

## Decisions at a glance

| Concern | Choice |
|---|---|
| Workflow definition model | Code per project — workflows live in `src/projects/<id>/workflows/*.ts` |
| Routing | URL-namespaced: `/api/:projectId/<trigger>/webhook` |
| Customer identification | URL path parameter |
| Number of projects (initial) | 1–5; hand-written registry |
| Config flow | Through workflow input (`TriggerInput<TConfig, TPayload>`). Nodes stay pure. |
| Config storage | `.env` with project-id prefix (`ACME_TELEGRAM_BOT_TOKEN`). DB later. |
| Nodes | Shared + project-specific. Shared in `src/shared/nodes/`, project-specific in `src/projects/<id>/nodes/`. |
| Trigger controllers | One controller per trigger type, project-agnostic, dispatches via registry. |

## File layout

```
src/
  engine/                       # unchanged
  shared/
    nodes/                      # domain-generic, reusable across projects
      telegram-in.node.ts
      say-hi.node.ts
  projects/
    projects.module.ts          # imports each project module
    project-registry.ts         # ProjectRegistry @Injectable service
    project.types.ts            # Project<TConfig>, TriggerInput, ProjectWorkflows
    acme/
      acme.module.ts            # @Module declaring Acme's project-specific nodes
      acme.config.ts            # reads ACME_* env vars, exports AcmeConfig + acmeConfig
      acme.registry.ts          # exports `acmeProject: Project<AcmeConfig>`
      nodes/                    # acme-specific nodes
      workflows/                # acme workflows (one per trigger)
        telegram-greet.workflow.ts
    globex/
      globex.module.ts
      globex.config.ts
      globex.registry.ts
      nodes/
      workflows/
  triggers/
    telegram.controller.ts      # POST /api/:projectId/telegram/webhook
  app.module.ts                 # imports EngineModule + ProjectsModule + triggers
```

Shared nodes are domain-generic — they don't know about projects. Project-specific nodes (e.g. `AcmeLoyaltyNode`) live under their owner project and are imported only by that project's workflows.

Workflows are plain async functions in all cases. They are never Nest providers.

## Types

```ts
// src/projects/project.types.ts
import type { WorkflowFn } from '../engine';

export type ProjectId = string;

// Telegram update shape lives next to its node; re-exported here for convenience
export type TelegramUpdate = {
  message?: { chat: { id: number }; text?: string };
};

// Every trigger workflow receives this shape. project.config carries the
// per-project secrets/settings; payload is the raw trigger event body.
export type TriggerInput<TConfig, TPayload> = {
  project: { id: ProjectId; config: TConfig };
  payload: TPayload;
};

// Workflows a project may handle, keyed by trigger type. All optional.
// The generic on TConfig links each workflow's expected config to the
// project's declared config — TS catches mismatches at compile time.
export type ProjectWorkflows<TConfig> = {
  telegram?: WorkflowFn<TriggerInput<TConfig, TelegramUpdate>, void>;
  // future: slack?, cron?, httpEvent?, ...
};

export interface Project<TConfig = unknown> {
  id: ProjectId;
  config: TConfig;
  workflows: ProjectWorkflows<TConfig>;
}
```

## ProjectRegistry

A plain Nest `@Injectable()` service. Holds a `Map<ProjectId, Project<unknown>>` built at construction time. Adding a project is a one-line entry.

```ts
// src/projects/project-registry.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Project, ProjectId } from './project.types';
import { acmeProject } from './acme/acme.registry';
import { globexProject } from './globex/globex.registry';

@Injectable()
export class ProjectRegistry {
  private readonly projects = new Map<ProjectId, Project<unknown>>([
    [acmeProject.id, acmeProject as Project<unknown>],
    [globexProject.id, globexProject as Project<unknown>],
  ]);

  get(id: ProjectId): Project<unknown> | undefined {
    return this.projects.get(id);
  }

  require(id: ProjectId): Project<unknown> {
    const p = this.get(id);
    if (!p) throw new NotFoundException(`project '${id}' not found`);
    return p;
  }
}
```

The `as Project<unknown>` cast intentionally drops the per-project config type at the registry boundary. The strict typing is recovered at each workflow's definition site (the workflow declares its own `TConfig`).

## Per-project module shape

Each project's `*.module.ts` declares only project-specific node providers. It does NOT declare workflows (workflows are plain functions).

```ts
// src/projects/acme/acme.module.ts
import { Module } from '@nestjs/common';
import { AcmeLoyaltyNode } from './nodes/acme-loyalty.node';

@Module({
  providers: [AcmeLoyaltyNode],
  exports: [AcmeLoyaltyNode],
})
export class AcmeModule {}
```

If a project has no project-specific nodes, its module is empty providers but still imported by `ProjectsModule` for symmetry and future-proofing.

```ts
// src/projects/projects.module.ts
import { Module } from '@nestjs/common';
import { ProjectRegistry } from './project-registry';
import { AcmeModule } from './acme/acme.module';
import { GlobexModule } from './globex/globex.module';

@Module({
  imports: [AcmeModule, GlobexModule],
  providers: [ProjectRegistry],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
```

## Per-project config

```ts
// src/projects/acme/acme.config.ts
export type AcmeConfig = {
  telegramBotToken: string;
  // future per-project settings
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const acmeConfig: AcmeConfig = {
  telegramBotToken: requireEnv('ACME_TELEGRAM_BOT_TOKEN'),
};
```

Module import side-effect: `acmeConfig` is constructed at module load. If `ACME_TELEGRAM_BOT_TOKEN` is missing, the app fails fast on boot. No silent degradation.

For tests, env vars are stubbed in `beforeAll` or via Nest test module overrides (override `ProjectRegistry` with a synthetic registry).

## Project registry export

```ts
// src/projects/acme/acme.registry.ts
import type { Project } from '../project.types';
import { acmeConfig, type AcmeConfig } from './acme.config';
import { acmeTelegramGreetWf } from './workflows/telegram-greet.workflow';

export const acmeProject: Project<AcmeConfig> = {
  id: 'acme',
  config: acmeConfig,
  workflows: {
    telegram: acmeTelegramGreetWf,
  },
};
```

## Project workflow

```ts
// src/projects/acme/workflows/telegram-greet.workflow.ts
import type { WorkflowFn } from '../../../engine';
import type { TriggerInput, TelegramUpdate } from '../../project.types';
import type { AcmeConfig } from '../acme.config';
import { TelegramWebhookNode } from '../../../shared/nodes/telegram-in.node';
import { SayHiNode } from '../../../shared/nodes/say-hi.node';

export const acmeTelegramGreetWf: WorkflowFn<
  TriggerInput<AcmeConfig, TelegramUpdate>,
  void
> = async function acmeTelegramGreetWf(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  await ctx.run(SayHiNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chatId,
    text: 'hi',
  });
};
```

`SayHiNode` is shared (project-agnostic). It receives the bot token as a typed input field. The node never reads `process.env` directly. This keeps the node reusable across projects and trivially testable.

## Trigger controller

```ts
// src/triggers/telegram.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { WorkflowEngine } from '../engine';
import { ProjectRegistry } from '../projects/project-registry';

@Controller('api/:projectId/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly registry: ProjectRegistry,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Param('projectId') projectId: string,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    const project = this.registry.require(projectId);
    const wf = project.workflows.telegram;
    if (!wf) {
      throw new BadRequestException(
        `project '${projectId}' has no telegram workflow`,
      );
    }

    try {
      await this.engine.run(wf, {
        project: { id: project.id, config: project.config },
        payload: update,
      });
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
```

Controller is dispatch-only. It does not know about Acme or Globex. It does not validate the update body shape — that's the workflow's first node's job (`TelegramWebhookNode`).

Engine errors are caught and logged. The HTTP response is always 200 to Telegram to avoid retry storms. (Production may differentiate later: 5xx for true infra failures, 200 for workflow errors.)

## Request lifecycle

1. Telegram (or whatever transport) sends `POST /api/<projectId>/telegram/webhook` with body = `TelegramUpdate`.
2. `TelegramController.webhook(projectId, update)` is invoked.
3. `registry.require(projectId)` → `Project<unknown>` (or 400 if id unknown).
4. `project.workflows.telegram` → `WorkflowFn` (or 400 if project has no telegram workflow).
5. `engine.run(wf, { project: { id, config }, payload: update })` executes.
6. Engine creates fresh `Trace`, fresh `ContextImpl`, calls `wf(input, ctx)`.
7. Workflow body runs nodes via `ctx.run(...)`. Each node call records a step in the trace.
8. On success, controller may log a one-line summary (`workflow <name> ok, <n> steps`). On `WorkflowError`, controller logs the error + stack.
9. Controller returns `200 { ok: true }`.

## Adding a new project (`zzz`)

1. Create `src/projects/zzz/` containing: `zzz.module.ts`, `zzz.config.ts`, `zzz.registry.ts`, optional `nodes/`, `workflows/<trigger>.workflow.ts`.
2. Add `ZzzModule` to `imports: [...]` in `src/projects/projects.module.ts`.
3. Add `[zzzProject.id, zzzProject]` to the map in `src/projects/project-registry.ts`.
4. Add the required env vars (e.g. `ZZZ_TELEGRAM_BOT_TOKEN`) to `.env`.
5. Register the webhook with Telegram: `setWebhook?url=https://YOUR_HOST/api/zzz/telegram/webhook`.

Zero touches to engine code. Zero touches to other projects. Zero touches to shared nodes (unless the new project needs a new shared node, which is its own change).

## Type-safety contract

- `Project<TConfig>` ties config type to workflow input type via the `ProjectWorkflows<TConfig>` generic. Assigning a workflow whose `TConfig` differs from the project's declared `TConfig` is a compile-time error at the project registry file.
- `TriggerInput<TConfig, TPayload>` is the only shape used inside workflows. Workflows read `input.project.config` with full type safety against their declared `TConfig`.
- `ProjectRegistry` deliberately erases the per-project config type to `unknown` at the registry boundary. The controller never sees the inner type. Workflows recover the type via their imported `*.config.ts` files.
- No `any` is introduced. The only loosening is `Project<unknown>` at the registry boundary, which is necessary because the registry holds heterogeneous project types.

## Error handling

- **Unknown project id**: `ProjectRegistry.require()` throws `NotFoundException` (Nest serializes to 404). The controller currently uses `require()`; if we later prefer 400, switch to `BadRequestException`.
- **Project lacks trigger workflow**: controller throws `BadRequestException` (400).
- **Workflow throws**: caught by controller, logged, returns 200 to caller. The `WorkflowError` carries the trace for inspection in logs.
- **Missing env var on boot**: `requireEnv` throws synchronously during module import. App boot fails. No silent fallback.

## Testing strategy

| Layer | Approach |
|---|---|
| Shared node | Direct `new Node()` + mock external IO. No engine, no project context. |
| Project-specific node | Same. Test as plain class. |
| Project workflow | Real `WorkflowEngine` in Nest test module importing `EngineModule` + the project's `*Module` + any shared node providers. Build `TriggerInput` with mock config + payload. Mock external IO. |
| `ProjectRegistry` | Direct construction or `Test.createTestingModule({ imports: [ProjectsModule] })`. Cover `get` known/unknown and `require` throws. |
| Trigger controller | Nest test module with overridden `ProjectRegistry` + `WorkflowEngine`. Use supertest. Cover: 200 happy path, 404 unknown project, 400 missing trigger, 200 + log on engine throw. |
| Boot test | Compile `AppModule` with all required env vars set; assert success. Compile with a required var missing; assert throw. |

E2E tests against a real Telegram webhook are out of scope for this slice.

## Explicitly out of scope (this slice)

- Project config persistence in DB. Stays in `.env` for now. Migration path: replace `*.config.ts` with a config service that reads from DB; `Project` shape doesn't change.
- Trigger types other than Telegram. Adding Slack/cron/etc. is its own change: new shared node(s) + new controller + new key on `ProjectWorkflows`.
- Per-project authentication / authorization beyond the project id in the URL. Future hardening will likely add a per-project webhook secret token.
- Per-project rate limiting, quotas, or billing.
- Per-project request scoping in Nest DI. All nodes remain singletons.

## Open questions deferred to implementation

- Should `ProjectRegistry.require` throw `NotFoundException` (404) or `BadRequestException` (400) for unknown project ids? Both are defensible. Initial choice: 404. Revisit if Telegram's retry semantics push us toward 4xx vs 5xx tuning.
- Whether to add a webhook secret check (Telegram's `X-Telegram-Bot-Api-Secret-Token` header) per project at the controller layer. Useful for production. Skipped for v1 to keep the surface small.
- When more than 5 projects exist, whether to auto-load project registries via filesystem scan / Nest discovery instead of hand-edited `project-registry.ts`. Defer until pain is real.
