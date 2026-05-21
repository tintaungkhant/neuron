# Multi-Tenant Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project (tenant) namespacing on top of engine v1.1. URL-routed (`/api/:projectId/telegram/webhook`), code-per-project workflows, config flows through workflow input from `.env`. Spec: `docs/superpowers/specs/2026-05-20-multi-tenant-projects-design.md`.

**Architecture:** `ProjectRegistry` (Nest `@Injectable`) maps `projectId` → `Project<unknown>`. Each project has its own folder containing a Nest module (project-specific node providers), config file (reads `<ID>_*` env vars), registry export (`<id>Project: Project<TConfig>`), and workflows (plain async functions). Shared nodes live under `src/shared/nodes/`. A `TelegramController` dispatches webhooks by project id and trigger key. Engine, workflows, and nodes remain unchanged in behavior — only the surrounding wiring is new.

**Tech Stack:** TypeScript 5.7, NestJS 11, pnpm, Jest 30 (ts-jest), ESLint 9.

**Implementation refinement vs. spec:** Spec illustrates a `ProjectRegistry` whose `Map` is built from hardcoded project imports inside the registry file. This plan uses Nest's DI: an injection token `PROJECT_REGISTRATIONS` provides the array of `Project<unknown>` entries. `ProjectsModule` is the one place projects are listed. This keeps the registry class trivially testable (`new ProjectRegistry([fakeProject])`) and contains adding-a-project to a single file edit. Spec's `Project` shape, `TriggerInput`, and overall behavior are unchanged.

---

## File Structure

Files this plan creates:

```
src/
  projects/
    project.types.ts                      # Project<TConfig>, TriggerInput, ProjectWorkflows
    project-registry.ts                   # ProjectRegistry service + PROJECT_REGISTRATIONS token
    project-registry.spec.ts              # registry tests
    projects.module.ts                    # imports project modules, provides registry
    demo/
      demo.module.ts                      # @Module declaring demo's nodes (empty providers list)
      demo.config.ts                      # DemoConfig + demoConfig reading DEMO_* env
      demo.registry.ts                    # demoProject: Project<DemoConfig>
      workflows/
        telegram-hi.workflow.ts           # demoTelegramHiWf
        telegram-hi.workflow.spec.ts      # workflow integration test
  shared/
    nodes/
      telegram-in.node.ts                 # parses Telegram update
      telegram-in.node.spec.ts
      say-hi.node.ts                      # sends Telegram message; botToken in input
      say-hi.node.spec.ts
  triggers/
    telegram.controller.ts                # POST /api/:projectId/telegram/webhook
    telegram.controller.spec.ts
```

Files this plan modifies:

```
src/app.module.ts                         # import ProjectsModule + TelegramController
```

Files this plan deletes from the working tree (uncommitted testing scaffolding that conflicts with the new structure):

```
src/nodes/                                # old testing nodes (telegram-in, process, say-hi)
src/workflows/                            # old testing workflow
src/telegram.controller.ts                # old testing controller
```

The current `src/main.ts` (loads `.env` via `process.loadEnvFile`, enables shutdown hooks, voids the bootstrap promise) is kept as-is. The current `.env` (`TELEGRAM_BOT_TOKEN=...`) is renamed to `DEMO_TELEGRAM_BOT_TOKEN=...` so the demo project can read it.

---

## Task 1: Reset working tree

The repo has uncommitted Telegram testing scaffolding under `src/nodes/`, `src/workflows/`, `src/telegram.controller.ts`, plus modifications to `src/app.module.ts`. These conflict with the new layout. Restore `src/app.module.ts` to the committed state and delete the test directories so the plan can start from a clean slate. Keep `src/main.ts` and `.env` (env loading + token are still useful) — only rename the env key.

**Files:**
- Restore: `src/app.module.ts`
- Delete: `src/nodes/telegram-in.node.ts`, `src/nodes/process.node.ts`, `src/nodes/say-hi.node.ts`, `src/nodes/` directory
- Delete: `src/workflows/telegram-greet.workflow.ts`, `src/workflows/` directory
- Delete: `src/telegram.controller.ts`
- Modify: `.env` (rename `TELEGRAM_BOT_TOKEN` to `DEMO_TELEGRAM_BOT_TOKEN`)

- [ ] **Step 1: Restore `src/app.module.ts`**

Run:
```bash
git restore src/app.module.ts
```

Verify it now reads exactly:

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EngineModule } from './engine';

@Module({
  imports: [EngineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2: Delete the testing scaffolding directories and file**

Run:
```bash
rm -rf src/nodes src/workflows src/telegram.controller.ts
```

- [ ] **Step 3: Rename env var in `.env`**

Edit `.env`. Change the existing `TELEGRAM_BOT_TOKEN=...` line so the key becomes `DEMO_TELEGRAM_BOT_TOKEN`:

```
DEMO_TELEGRAM_BOT_TOKEN=8715130537:AAGKi1v9V6PcPmynsIAzGUL-OdLta5Teh9k
```

(Leave the token value as-is. Later tasks will read this key.)

- [ ] **Step 4: Verify working tree compiles and tests pass**

Run:
```bash
pnpm exec tsc --noEmit
pnpm test
pnpm lint
```

Expected: TypeScript clean, 17/17 tests pass (engine baseline), lint clean. `src/main.ts` is the only file still showing as modified in `git status`.

- [ ] **Step 5: No commit yet**

This task only resets the working tree. The next task adds new files and commits them.

---

## Task 2: Project types

Create the type-only file that all later code imports from. No runtime, no tests — verified via `tsc --noEmit`.

**Files:**
- Create: `src/projects/project.types.ts`

- [ ] **Step 1: Create `src/projects/project.types.ts`**

```ts
import type { WorkflowFn } from '../engine';

export type ProjectId = string;

export type TelegramUpdate = {
  message?: { chat: { id: number }; text?: string };
};

export type TriggerInput<TConfig, TPayload> = {
  project: { id: ProjectId; config: TConfig };
  payload: TPayload;
};

export type ProjectWorkflows<TConfig> = {
  telegram?: WorkflowFn<TriggerInput<TConfig, TelegramUpdate>, void>;
};

export interface Project<TConfig = unknown> {
  id: ProjectId;
  config: TConfig;
  workflows: ProjectWorkflows<TConfig>;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Verify lint**

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/projects/project.types.ts
git commit -m "feat(projects): add Project<TConfig>, TriggerInput, ProjectWorkflows types"
```

---

## Task 3: ProjectRegistry

A Nest `@Injectable` service that holds `Map<ProjectId, Project<unknown>>`. The map is seeded via an injected array bound to a `PROJECT_REGISTRATIONS` token. This keeps the registry trivially testable (construct directly with an array) and means adding a project later means editing only `projects.module.ts`.

**Files:**
- Create: `src/projects/project-registry.ts`
- Create: `src/projects/project-registry.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/projects/project-registry.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { ProjectRegistry } from './project-registry';
import type { Project } from './project.types';

const acmeProject: Project<{ name: string }> = {
  id: 'acme',
  config: { name: 'Acme' },
  workflows: {},
};

const globexProject: Project<{ name: string }> = {
  id: 'globex',
  config: { name: 'Globex' },
  workflows: {},
};

describe('ProjectRegistry', () => {
  it('returns a registered project by id', () => {
    const reg = new ProjectRegistry([
      acmeProject as Project<unknown>,
      globexProject as Project<unknown>,
    ]);
    expect(reg.get('acme')).toBe(acmeProject);
    expect(reg.get('globex')).toBe(globexProject);
  });

  it('get returns undefined for unknown ids', () => {
    const reg = new ProjectRegistry([]);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('require throws NotFoundException for unknown ids', () => {
    const reg = new ProjectRegistry([]);
    expect(() => reg.require('nope')).toThrow(NotFoundException);
    expect(() => reg.require('nope')).toThrow("project 'nope' not found");
  });

  it('require returns the project for a known id', () => {
    const reg = new ProjectRegistry([acmeProject as Project<unknown>]);
    expect(reg.require('acme')).toBe(acmeProject);
  });

  it('seeds an empty registry when no registrations are provided', () => {
    const reg = new ProjectRegistry([]);
    expect(reg.get('any')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- project-registry.spec`
Expected: FAIL — `ProjectRegistry` not found.

- [ ] **Step 3: Implement `ProjectRegistry`**

Create `src/projects/project-registry.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Project, ProjectId } from './project.types';

export const PROJECT_REGISTRATIONS = Symbol('PROJECT_REGISTRATIONS');

@Injectable()
export class ProjectRegistry {
  private readonly projects: Map<ProjectId, Project<unknown>>;

  constructor(
    @Inject(PROJECT_REGISTRATIONS)
    registrations: Project<unknown>[],
  ) {
    this.projects = new Map(registrations.map((p) => [p.id, p]));
  }

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

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- project-registry.spec`
Expected: PASS (5 tests).

The tests construct `new ProjectRegistry([...])` directly. Nest's `@Inject` decorator only affects behavior inside the DI container; direct construction passes the array as the first positional arg.

- [ ] **Step 5: Verify lint + full test run**

Run:
```bash
pnpm lint
pnpm test
```
Expected: lint clean; full suite 22/22 (engine 17 + new 5).

- [ ] **Step 6: Commit**

```bash
git add src/projects/project-registry.ts src/projects/project-registry.spec.ts
git commit -m "feat(projects): ProjectRegistry with injected registrations"
```

---

## Task 4: Shared `TelegramWebhookNode`

A domain-generic node that parses a Telegram `Update` into `{ chatId, text }`. Project-agnostic; reusable across any project that handles Telegram.

**Files:**
- Create: `src/shared/nodes/telegram-in.node.ts`
- Create: `src/shared/nodes/telegram-in.node.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/shared/nodes/telegram-in.node.spec.ts`:

```ts
import { TelegramWebhookNode } from './telegram-in.node';

describe('TelegramWebhookNode', () => {
  it('parses chatId and text from a Telegram update', async () => {
    const node = new TelegramWebhookNode();
    const out = await node.execute({
      message: { chat: { id: 42 }, text: 'hello' },
    });
    expect(out).toEqual({ chatId: 42, text: 'hello' });
  });

  it('returns chatId 0 and empty text when message is missing', async () => {
    const node = new TelegramWebhookNode();
    const out = await node.execute({});
    expect(out).toEqual({ chatId: 0, text: '' });
  });

  it('returns chatId from chat and empty text when text is missing', async () => {
    const node = new TelegramWebhookNode();
    const out = await node.execute({ message: { chat: { id: 7 } } });
    expect(out).toEqual({ chatId: 7, text: '' });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- telegram-in.node.spec`
Expected: FAIL — `./telegram-in.node` not found.

- [ ] **Step 3: Implement `TelegramWebhookNode`**

Create `src/shared/nodes/telegram-in.node.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Node } from '../../engine';
import type { TelegramUpdate } from '../../projects/project.types';

export type TelegramInOutput = {
  chatId: number;
  text: string;
};

@Injectable()
export class TelegramWebhookNode extends Node<TelegramUpdate, TelegramInOutput> {
  execute(input: TelegramUpdate): Promise<TelegramInOutput> {
    const chatId = input.message?.chat.id ?? 0;
    const text = input.message?.text ?? '';
    return Promise.resolve({ chatId, text });
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- telegram-in.node.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify lint + full suite**

Run:
```bash
pnpm lint
pnpm test
```
Expected: clean; full suite 25/25.

- [ ] **Step 6: Commit**

```bash
git add src/shared/nodes/telegram-in.node.ts src/shared/nodes/telegram-in.node.spec.ts
git commit -m "feat(shared): TelegramWebhookNode parses chatId + text from update"
```

---

## Task 5: Shared `SayHiNode`

Sends a Telegram message via `sendMessage`. The bot token is part of the typed input (NOT read from `process.env`). Node is stateless and reusable across any project that provides its own token.

**Files:**
- Create: `src/shared/nodes/say-hi.node.ts`
- Create: `src/shared/nodes/say-hi.node.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/shared/nodes/say-hi.node.spec.ts`:

```ts
import { SayHiNode } from './say-hi.node';

describe('SayHiNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs to the Telegram sendMessage endpoint with chat_id and text', async () => {
    fetchSpy.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const node = new SayHiNode();
    await node.execute({ botToken: 'abc123', chatId: 42, text: 'hi' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botabc123/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: 42, text: 'hi' });
  });

  it('throws when sendMessage returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const node = new SayHiNode();
    await expect(
      node.execute({ botToken: 't', chatId: 1, text: 'x' }),
    ).rejects.toThrow(/sendMessage failed: 403 forbidden/);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- say-hi.node.spec`
Expected: FAIL — `./say-hi.node` not found.

- [ ] **Step 3: Implement `SayHiNode`**

Create `src/shared/nodes/say-hi.node.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Node } from '../../engine';

export type SayHiInput = {
  botToken: string;
  chatId: number;
  text: string;
};

@Injectable()
export class SayHiNode extends Node<SayHiInput, void> {
  private readonly logger = new Logger(SayHiNode.name);

  async execute(input: SayHiInput): Promise<void> {
    const url = `https://api.telegram.org/bot${input.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: input.chatId, text: input.text }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`sendMessage failed: ${res.status} ${body}`);
    }

    this.logger.log(`replied to chat ${input.chatId}: "${input.text}"`);
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- say-hi.node.spec`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify lint + full suite**

Run:
```bash
pnpm lint
pnpm test
```
Expected: clean; full suite 27/27.

- [ ] **Step 6: Commit**

```bash
git add src/shared/nodes/say-hi.node.ts src/shared/nodes/say-hi.node.spec.ts
git commit -m "feat(shared): SayHiNode takes botToken via typed input"
```

---

## Task 6: `ProjectsModule` skeleton (empty registrations)

The Nest module that exports `ProjectRegistry`. At this point no concrete projects exist yet — the registrations factory returns an empty array. Task 8 (demo project) edits this file to add the demo project to the registrations.

**Files:**
- Create: `src/projects/projects.module.ts`

- [ ] **Step 1: Create `src/projects/projects.module.ts`**

```ts
import { Module } from '@nestjs/common';
import {
  PROJECT_REGISTRATIONS,
  ProjectRegistry,
} from './project-registry';
import type { Project } from './project.types';

@Module({
  imports: [],
  providers: [
    ProjectRegistry,
    {
      provide: PROJECT_REGISTRATIONS,
      useFactory: (): Project<unknown>[] => [],
    },
  ],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify lint + tests**

Run:
```bash
pnpm lint
pnpm test
```
Expected: clean; 27/27.

- [ ] **Step 4: Commit**

```bash
git add src/projects/projects.module.ts
git commit -m "feat(projects): ProjectsModule with empty registrations"
```

---

## Task 7: `TelegramController`

Routes `POST /api/:projectId/telegram/webhook`. Looks up the project via `ProjectRegistry`, picks the project's telegram workflow, runs the engine. Returns 200 even on workflow errors (logs the error). Unknown project → 404. Project with no telegram workflow → 400.

**Files:**
- Create: `src/triggers/telegram.controller.ts`
- Create: `src/triggers/telegram.controller.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `src/triggers/telegram.controller.spec.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { EngineModule, WorkflowEngine, Node } from '../engine';
import {
  PROJECT_REGISTRATIONS,
  ProjectRegistry,
} from '../projects/project-registry';
import type {
  Project,
  TelegramUpdate,
  TriggerInput,
} from '../projects/project.types';
import { TelegramController } from './telegram.controller';

type DemoConfig = { token: string };

@Injectable()
class StubSayNode extends Node<{ msg: string }, void> {
  static lastInput: { msg: string } | undefined;
  execute(input: { msg: string }) {
    StubSayNode.lastInput = input;
    return Promise.resolve();
  }
}

const demoProject: Project<DemoConfig> = {
  id: 'demo',
  config: { token: 'tok' },
  workflows: {
    telegram: async function demoWf(
      input: TriggerInput<DemoConfig, TelegramUpdate>,
      ctx,
    ) {
      await ctx.run(StubSayNode, { msg: input.payload.message?.text ?? '' });
    },
  },
};

const projectWithoutTelegram: Project<DemoConfig> = {
  id: 'silent',
  config: { token: 'tok' },
  workflows: {},
};

describe('TelegramController', () => {
  let app: TestingModule;
  let server: ReturnType<TestingModule['createNestApplication']>;

  beforeEach(async () => {
    StubSayNode.lastInput = undefined;
    app = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        StubSayNode,
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [
            demoProject as Project<unknown>,
            projectWithoutTelegram as Project<unknown>,
          ],
        },
      ],
    }).compile();
    server = app.createNestApplication();
    await server.init();
  });

  afterEach(async () => {
    await server.close();
  });

  it('runs the project telegram workflow on a known project', async () => {
    await request(server.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send({ message: { chat: { id: 1 }, text: 'hi' } })
      .expect(200)
      .expect({ ok: true });

    expect(StubSayNode.lastInput).toEqual({ msg: 'hi' });
  });

  it('returns 404 when the project id is unknown', async () => {
    await request(server.getHttpServer())
      .post('/api/nope/telegram/webhook')
      .send({})
      .expect(404);
  });

  it('returns 400 when the project has no telegram workflow', async () => {
    await request(server.getHttpServer())
      .post('/api/silent/telegram/webhook')
      .send({})
      .expect(400);
  });

  it('returns 200 and logs when the workflow throws', async () => {
    const throwingProject: Project<DemoConfig> = {
      id: 'boom',
      config: { token: 'tok' },
      workflows: {
        // eslint-disable-next-line @typescript-eslint/require-await
        telegram: async function boomWf() {
          throw new Error('workflow failed inside');
        },
      },
    };

    const localApp = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [throwingProject as Project<unknown>],
        },
      ],
    }).compile();
    const localServer = localApp.createNestApplication();
    await localServer.init();

    try {
      await request(localServer.getHttpServer())
        .post('/api/boom/telegram/webhook')
        .send({})
        .expect(200)
        .expect({ ok: true });
    } finally {
      await localServer.close();
    }
  });

  it('injects project id and config into the workflow input', async () => {
    @Injectable()
    class CaptureNode extends Node<
      { project: { id: string; config: DemoConfig } },
      void
    > {
      static lastInput:
        | { project: { id: string; config: DemoConfig } }
        | undefined;
      execute(input: { project: { id: string; config: DemoConfig } }) {
        CaptureNode.lastInput = input;
        return Promise.resolve();
      }
    }

    const captureProject: Project<DemoConfig> = {
      id: 'capture',
      config: { token: 'secret' },
      workflows: {
        telegram: async function captureWf(input, ctx) {
          await ctx.run(CaptureNode, { project: input.project });
        },
      },
    };

    const localApp = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        CaptureNode,
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [captureProject as Project<unknown>],
        },
      ],
    }).compile();
    const localServer = localApp.createNestApplication();
    await localServer.init();

    try {
      await request(localServer.getHttpServer())
        .post('/api/capture/telegram/webhook')
        .send({})
        .expect(200);
      expect(CaptureNode.lastInput).toEqual({
        project: { id: 'capture', config: { token: 'secret' } },
      });
    } finally {
      await localServer.close();
    }
  });
});
```

The `supertest` import is needed. It's already in devDependencies (`pnpm-lock.yaml` shows `supertest@^7.0.0`).

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test -- telegram.controller.spec`
Expected: FAIL — `./telegram.controller` not found.

- [ ] **Step 3: Implement `TelegramController`**

Create `src/triggers/telegram.controller.ts`:

```ts
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

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm test -- telegram.controller.spec`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify lint + full suite**

Run:
```bash
pnpm lint
pnpm test
```
Expected: clean; full suite 32/32.

- [ ] **Step 6: Commit**

```bash
git add src/triggers/telegram.controller.ts src/triggers/telegram.controller.spec.ts
git commit -m "feat(triggers): TelegramController dispatches webhooks by project"
```

---

## Task 8: Demo project

A concrete example project to serve as a template and provide a real wiring smoke test. Reads its bot token from `DEMO_TELEGRAM_BOT_TOKEN`. Workflow takes the incoming Telegram update, ignores its text, and replies "hi".

**Files:**
- Create: `src/projects/demo/demo.config.ts`
- Create: `src/projects/demo/demo.module.ts`
- Create: `src/projects/demo/demo.registry.ts`
- Create: `src/projects/demo/workflows/telegram-hi.workflow.ts`
- Create: `src/projects/demo/workflows/telegram-hi.workflow.spec.ts`
- Modify: `src/projects/projects.module.ts` (add demo to registrations)

- [ ] **Step 1: Create the demo config**

Create `src/projects/demo/demo.config.ts`:

```ts
export type DemoConfig = {
  telegramBotToken: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

export const demoConfig: DemoConfig = {
  telegramBotToken: requireEnv('DEMO_TELEGRAM_BOT_TOKEN'),
};
```

- [ ] **Step 2: Create the demo Nest module**

Create `src/projects/demo/demo.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({
  providers: [],
  exports: [],
})
export class DemoModule {}
```

Empty providers list. The demo project has no project-specific nodes — its workflow uses shared nodes (`TelegramWebhookNode`, `SayHiNode`). The module exists so future demo-specific nodes have a place to land and so `ProjectsModule` has a consistent shape to import.

- [ ] **Step 3: Write failing test for the demo workflow**

Create `src/projects/demo/workflows/telegram-hi.workflow.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine } from '../../../engine';
import { TelegramWebhookNode } from '../../../shared/nodes/telegram-in.node';
import { SayHiNode } from '../../../shared/nodes/say-hi.node';
import type {
  TelegramUpdate,
  TriggerInput,
} from '../../project.types';
import type { DemoConfig } from '../demo.config';
import { demoTelegramHiWf } from './telegram-hi.workflow';

describe('demoTelegramHiWf', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramWebhookNode, SayHiNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await mod.close();
  });

  it("replies 'hi' to the incoming chat", async () => {
    const input: TriggerInput<DemoConfig, TelegramUpdate> = {
      project: { id: 'demo', config: { telegramBotToken: 'TESTTOKEN' } },
      payload: { message: { chat: { id: 99 }, text: 'anything' } },
    };

    const { trace } = await engine.run(demoTelegramHiWf, input);

    expect(trace.status).toBe('ok');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({ name: 'TelegramWebhookNode', status: 'ok' });
    expect(trace.steps[1]).toMatchObject({ name: 'SayHiNode', status: 'ok' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTESTTOKEN/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: 99,
      text: 'hi',
    });
  });
});
```

- [ ] **Step 4: Run test, verify it fails**

Run: `pnpm test -- telegram-hi.workflow.spec`
Expected: FAIL — workflow not found.

- [ ] **Step 5: Implement the workflow**

Create `src/projects/demo/workflows/telegram-hi.workflow.ts`:

```ts
import type { WorkflowFn } from '../../../engine';
import { TelegramWebhookNode } from '../../../shared/nodes/telegram-in.node';
import { SayHiNode } from '../../../shared/nodes/say-hi.node';
import type {
  TelegramUpdate,
  TriggerInput,
} from '../../project.types';
import type { DemoConfig } from '../demo.config';

export const demoTelegramHiWf: WorkflowFn<
  TriggerInput<DemoConfig, TelegramUpdate>,
  void
> = async function demoTelegramHiWf(input, ctx) {
  const parsed = await ctx.run(TelegramWebhookNode, input.payload);
  await ctx.run(SayHiNode, {
    botToken: input.project.config.telegramBotToken,
    chatId: parsed.chatId,
    text: 'hi',
  });
};
```

- [ ] **Step 6: Run test, verify it passes**

Run: `pnpm test -- telegram-hi.workflow.spec`
Expected: PASS (1 test).

- [ ] **Step 7: Create the demo registry export**

Create `src/projects/demo/demo.registry.ts`:

```ts
import type { Project } from '../project.types';
import { demoConfig, type DemoConfig } from './demo.config';
import { demoTelegramHiWf } from './workflows/telegram-hi.workflow';

export const demoProject: Project<DemoConfig> = {
  id: 'demo',
  config: demoConfig,
  workflows: {
    telegram: demoTelegramHiWf,
  },
};
```

- [ ] **Step 8: Wire demo into `ProjectsModule`**

Replace the contents of `src/projects/projects.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import {
  PROJECT_REGISTRATIONS,
  ProjectRegistry,
} from './project-registry';
import type { Project } from './project.types';
import { DemoModule } from './demo/demo.module';
import { demoProject } from './demo/demo.registry';

@Module({
  imports: [DemoModule],
  providers: [
    ProjectRegistry,
    {
      provide: PROJECT_REGISTRATIONS,
      useFactory: (): Project<unknown>[] => [
        demoProject as Project<unknown>,
      ],
    },
  ],
  exports: [ProjectRegistry],
})
export class ProjectsModule {}
```

- [ ] **Step 9: Verify lint + full suite**

Run:
```bash
pnpm lint
pnpm test
```
Expected: clean; full suite 33/33.

Note: `demoConfig` runs at module import time. The test environment must have `DEMO_TELEGRAM_BOT_TOKEN` set OR the workflow spec must avoid importing `demo.registry.ts` (only the workflow file). Inspect: the workflow spec imports `./telegram-hi.workflow` and types from `../demo.config`. Importing the `DemoConfig` type does NOT execute the file's top-level code (`import type` is erased at runtime). So the spec runs without needing the env var.

The boot test in Task 9 covers the env-var requirement.

- [ ] **Step 10: Commit**

```bash
git add src/projects/demo src/projects/projects.module.ts
git commit -m "feat(projects): demo project + DEMO_TELEGRAM_BOT_TOKEN wiring"
```

---

## Task 9: Wire `AppModule` + boot test

Connect `ProjectsModule` and `TelegramController` into the application's root module. Add a smoke test that boots `AppModule` to catch wiring/env-var problems at CI time.

**Files:**
- Modify: `src/app.module.ts`
- Create: `src/app.module.spec.ts`

- [ ] **Step 1: Read the current `src/app.module.ts`**

Expected current contents (after Task 1 restored it):

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EngineModule } from './engine';

@Module({
  imports: [EngineModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 2: Modify `src/app.module.ts`**

Replace contents with:

```ts
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EngineModule } from './engine';
import { ProjectsModule } from './projects/projects.module';
import { TelegramController } from './triggers/telegram.controller';

@Module({
  imports: [EngineModule, ProjectsModule],
  controllers: [AppController, TelegramController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Write boot test**

Create `src/app.module.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  const ORIGINAL_TOKEN = process.env.DEMO_TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.DEMO_TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
    }
    jest.resetModules();
  });

  it('boots when all required env vars are set', async () => {
    process.env.DEMO_TELEGRAM_BOT_TOKEN = 'test-token';
    jest.resetModules();
    const { AppModule: FreshAppModule } = await import('./app.module');
    const mod = await Test.createTestingModule({
      imports: [FreshAppModule],
    }).compile();
    await mod.close();
  });

  it('fails to boot when DEMO_TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    jest.resetModules();
    await expect(import('./app.module')).rejects.toThrow(
      /missing env DEMO_TELEGRAM_BOT_TOKEN/,
    );
  });
});
```

`jest.resetModules()` is needed because `demo.config.ts` runs its top-level `requireEnv` once on first import and caches the result. The second test needs a fresh module graph to re-evaluate the env check.

`AppModule` is imported at the top of the file too — meaning the first boot test runs WITHOUT a token if Jest evaluates the top import before the test body. We use a dynamic `await import('./app.module')` inside each test so the env var is set before the module graph is evaluated.

However Jest hoists `import` statements: the static `import { AppModule } from './app.module'` at the top of the spec WILL evaluate before any test body. If `DEMO_TELEGRAM_BOT_TOKEN` is unset at that moment, the import throws and the entire suite fails.

Fix: remove the static import. Only use dynamic `import('./app.module')` inside tests. Updated spec:

```ts
import { Test } from '@nestjs/testing';

describe('AppModule', () => {
  const ORIGINAL_TOKEN = process.env.DEMO_TELEGRAM_BOT_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    } else {
      process.env.DEMO_TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN;
    }
    jest.resetModules();
  });

  it('boots when all required env vars are set', async () => {
    process.env.DEMO_TELEGRAM_BOT_TOKEN = 'test-token';
    jest.resetModules();
    const { AppModule } = await import('./app.module');
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await mod.close();
  });

  it('fails to boot when DEMO_TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.DEMO_TELEGRAM_BOT_TOKEN;
    jest.resetModules();
    await expect(import('./app.module')).rejects.toThrow(
      /missing env DEMO_TELEGRAM_BOT_TOKEN/,
    );
  });
});
```

Use this version.

- [ ] **Step 4: Run boot tests, verify they pass**

Ensure your shell has `DEMO_TELEGRAM_BOT_TOKEN` set (e.g. from `.env` if your shell loads it, or set it manually):
```bash
DEMO_TELEGRAM_BOT_TOKEN=dummy pnpm test -- app.module.spec
```
Expected: PASS (2 tests).

If Jest is configured to load `.env` automatically (it isn't in this repo, but you might add it later), the manual prefix is unnecessary.

- [ ] **Step 5: Run the full suite**

```bash
DEMO_TELEGRAM_BOT_TOKEN=dummy pnpm test
```
Expected: 35/35 passing.

- [ ] **Step 6: Verify lint + build**

```bash
pnpm lint
pnpm build
```
Expected: lint clean (the pre-existing `main.ts` warning is gone if `main.ts` was preserved with `void bootstrap()`; if a warning resurfaces, it's not introduced by this plan), build succeeds, `dist/` is populated.

- [ ] **Step 7: Commit**

```bash
git add src/app.module.ts src/app.module.spec.ts
git commit -m "feat(app): wire ProjectsModule + TelegramController + boot test"
```

---

## Done criteria

After Task 9:

- `src/projects/`, `src/shared/nodes/`, `src/triggers/` exist with the structure from the spec.
- One concrete project (`demo`) exists, reads `DEMO_TELEGRAM_BOT_TOKEN`, has a Telegram workflow that replies "hi" to any incoming message.
- `POST /api/demo/telegram/webhook` invokes that workflow via the engine.
- Adding another project means creating files under `src/projects/<id>/`, adding two lines to `src/projects/projects.module.ts` (`import { fooProject } from './foo/foo.registry';` and `fooProject as Project<unknown>` in the registrations array), and setting `<ID>_*` env vars.
- `pnpm test` runs all suites green (engine + project-registry + shared nodes + controller + demo workflow + boot test = ~35 tests).
- `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build` are clean.

## Out of scope (deferred to future plans)

- DB-backed project configuration.
- Additional trigger types (Slack, cron, generic HTTP).
- Per-project webhook secret token verification.
- Telegram trigger SLA tuning (200 vs 4xx vs 5xx on workflow errors).
- E2E tests against a live Telegram bot.
- Auto-loading projects via filesystem scan instead of hand-edited `projects.module.ts`.
