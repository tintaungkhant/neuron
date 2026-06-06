# Telegram Async Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram webhook enqueue each update to a Redis (BullMQ) queue and return 200 immediately, while a worker pool runs the workflow and records executions.

**Architecture:** The controller becomes a thin producer (`@InjectQueue` → `queue.add`). A new `TelegramProcessor` (`@Processor`, concurrency from config) consumes jobs and runs `engine.run(telegramWorkflow, ...)`, taking over the execution-recording logic that lived in the controller. BullMQ is wired in `AppModule` via `BullModule.forRoot` + `registerQueue`. No retries (`attempts: 1`) since the workflow is not idempotent. Engine code is untouched.

**Tech Stack:** NestJS 11, `@nestjs/bullmq` + `bullmq` + `ioredis` (Redis), Jest. Package manager **pnpm**.

**Conventions for the implementer:**
- Run a single spec with `pnpm test -- <pattern>`.
- App code (`src/app/`) may use engine exports; engine never imports app.
- Unit tests mock BullMQ — they never need a live Redis. Provide a mock queue with `getQueueToken(TELEGRAM_QUEUE)`; construct the processor directly with mocked collaborators.
- `appConfig` is a module-load singleton read at import time; the `@Processor` decorator can read `appConfig.queueConcurrency` at class-definition time.

---

## File Structure

- `package.json` — add `@nestjs/bullmq`, `bullmq`, `ioredis` deps. (modify)
- `src/app/config.ts` — add `redisUrl`, `queueConcurrency` to `appConfig`. (modify)
- `src/app/queue/queue.constants.ts` — queue + job name constants. (create)
- `src/app/queue/telegram.processor.ts` — BullMQ consumer; runs workflow + records execution. (create)
- `src/app/queue/telegram.processor.spec.ts` — processor unit tests. (create)
- `src/app/controllers/telegram.controller.ts` — thin producer (enqueue only). (modify)
- `src/app/controllers/telegram.controller.spec.ts` — rewritten for the producer. (modify)
- `src/app.module.ts` — `BullModule.forRoot` + `registerQueue` + register processor. (modify)

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json` (via pnpm)

- [ ] **Step 1: Install the queue dependencies**

Run: `pnpm add @nestjs/bullmq bullmq ioredis`
Expected: the three packages appear under `dependencies` in `package.json`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify the build still compiles**

Run: `pnpm build`
Expected: build succeeds (no usage yet — just confirms install is clean).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add bullmq + ioredis for the telegram queue"
```

---

## Task 2: Config — Redis URL and worker concurrency

**Files:**
- Modify: `src/app/config.ts`

- [ ] **Step 1: Add the two fields to AppConfig and appConfig**

In `src/app/config.ts`, add `redisUrl` and `queueConcurrency` to the `AppConfig` type:

```ts
export type AppConfig = {
  id: string;
  telegramBotToken: string;
  openRouterApiKey: string;
  openRouterModel: string;
  geminiApiKey: string;
  geminiModel: string;
  redisUrl: string;
  queueConcurrency: number;
};
```

Add the values to the `appConfig` object (after `geminiModel`):

```ts
  redisUrl: requireEnv('REDIS_URL'),
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY) || 5,
```

(`Number(undefined)` → `NaN` → falls back to 5; a non-numeric or `0` value also falls back to 5.)

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/config.ts
git commit -m "feat(app): read REDIS_URL and QUEUE_CONCURRENCY into appConfig"
```

---

## Task 3: Queue constants

**Files:**
- Create: `src/app/queue/queue.constants.ts`

- [ ] **Step 1: Create the constants file**

```ts
export const TELEGRAM_QUEUE = 'telegram';
export const PROCESS_UPDATE_JOB = 'process-update';
```

- [ ] **Step 2: Commit**

```bash
git add src/app/queue/queue.constants.ts
git commit -m "feat(app): telegram queue/job name constants"
```

---

## Task 4: TelegramProcessor (consumer)

**Files:**
- Create: `src/app/queue/telegram.processor.ts`
- Test: `src/app/queue/telegram.processor.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/queue/telegram.processor.spec.ts`:

```ts
import { ExecutionStore, WorkflowEngine, WorkflowError } from '../../engine';
import type { Trace } from '../../engine';
import { telegramWorkflow } from '../workflows/telegram-hi.workflow';
import { TelegramProcessor } from './telegram.processor';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import type { Job } from 'bullmq';

function trace(status: 'ok' | 'error' = 'ok'): Trace {
  return {
    workflowName: 'telegramWorkflow',
    startedAt: 0,
    finishedAt: 0,
    status,
    input: {},
    steps: [],
  };
}

const update = { update_id: 7 } as TelegramWebhookPayload;
const job = { data: update } as Job<TelegramWebhookPayload>;

describe('TelegramProcessor', () => {
  it('runs the workflow with the job data and saves the trace', async () => {
    const run = jest.fn().mockResolvedValue({ result: undefined, trace: trace() });
    const save = jest.fn().mockResolvedValue(1);
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await proc.process(job);

    expect(run).toHaveBeenCalledTimes(1);
    const [wf, input] = run.mock.calls[0] as [unknown, unknown];
    expect(wf).toBe(telegramWorkflow);
    expect(input).toBe(update);
    expect(save).toHaveBeenCalledWith(trace());
  });

  it('records the partial trace and rethrows on WorkflowError', async () => {
    const partial = trace('error');
    const run = jest.fn().mockRejectedValue(new WorkflowError(new Error('boom'), partial));
    const save = jest.fn().mockResolvedValue(2);
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await expect(proc.process(job)).rejects.toThrow('boom');
    expect(save).toHaveBeenCalledWith(partial);
  });

  it('rethrows a non-WorkflowError without saving', async () => {
    const run = jest.fn().mockRejectedValue(new Error('infra'));
    const save = jest.fn();
    const proc = new TelegramProcessor(
      { run } as unknown as WorkflowEngine,
      { save } as unknown as ExecutionStore,
    );

    await expect(proc.process(job)).rejects.toThrow('infra');
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- telegram.processor`
Expected: FAIL — `TelegramProcessor` does not exist.

- [ ] **Step 3: Implement the processor**

Create `src/app/queue/telegram.processor.ts`:

```ts
import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  WorkflowEngine,
  WorkflowError,
  ExecutionStore,
  enrichTrace,
  formatTrace,
  type Trace,
} from '../../engine';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import { telegramWorkflow } from '../workflows/telegram-hi.workflow';
import { appConfig } from '../config';
import { TELEGRAM_QUEUE } from './queue.constants';

@Processor(TELEGRAM_QUEUE, { concurrency: appConfig.queueConcurrency })
export class TelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly executions: ExecutionStore,
  ) {
    super();
  }

  async process(job: Job<TelegramWebhookPayload>): Promise<void> {
    try {
      const { trace } = await this.engine.run(telegramWorkflow, job.data);
      await this.record(trace);
    } catch (e) {
      // WorkflowError carries the partial trace — record the flow up to the break.
      if (e instanceof WorkflowError) {
        await this.record(e.trace);
      } else {
        this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
      }
      throw e; // surface to BullMQ's failed set (no retry: attempts=1)
    }
  }

  private async record(trace: Trace): Promise<void> {
    this.logger.log('\n' + formatTrace(enrichTrace(trace)));
    try {
      const id = await this.executions.save(trace);
      this.logger.log(`execution #${id} saved`);
    } catch (e) {
      // Persistence must never break job processing.
      this.logger.error(
        'failed to save execution',
        e instanceof Error ? e.stack : e,
      );
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- telegram.processor`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/queue/telegram.processor.ts src/app/queue/telegram.processor.spec.ts
git commit -m "feat(app): telegram queue processor runs workflow + records execution"
```

---

## Task 5: Controller becomes a thin producer

**Files:**
- Modify: `src/app/controllers/telegram.controller.ts`
- Test: `src/app/controllers/telegram.controller.spec.ts` (rewritten)

- [ ] **Step 1: Rewrite the controller spec**

Replace the entire contents of `src/app/controllers/telegram.controller.spec.ts` with:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { TelegramController } from './telegram.controller';
import { TELEGRAM_QUEUE, PROCESS_UPDATE_JOB } from '../queue/queue.constants';

describe('TelegramController', () => {
  let app: INestApplication;
  let addMock: jest.Mock;

  beforeEach(async () => {
    addMock = jest.fn().mockResolvedValue(undefined);
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: getQueueToken(TELEGRAM_QUEUE), useValue: { add: addMock } },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('enqueues the update with jobId = update_id and returns 200', async () => {
    const update = {
      update_id: 42,
      message: {
        message_id: 1,
        chat: { id: 5, type: 'private' },
        date: 1,
        text: 'hi',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send(update)
      .expect(200)
      .expect({ ok: true });

    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addMock.mock.calls[0] as [
      string,
      unknown,
      { jobId?: string; attempts?: number },
    ];
    expect(name).toBe(PROCESS_UPDATE_JOB);
    expect(data).toEqual(update);
    expect(opts.jobId).toBe('42');
    expect(opts.attempts).toBe(1);
  });

  it('still returns 200 when update_id is absent (no jobId)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send({})
      .expect(200)
      .expect({ ok: true });

    const [, , opts] = addMock.mock.calls[0] as [
      string,
      unknown,
      { jobId?: string },
    ];
    expect(opts.jobId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- telegram.controller`
Expected: FAIL — the controller still injects `WorkflowEngine`/`ExecutionStore` and has no queue; compile/DI errors.

- [ ] **Step 3: Rewrite the controller**

Replace the entire contents of `src/app/controllers/telegram.controller.ts` with:

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import { TELEGRAM_QUEUE, PROCESS_UPDATE_JOB } from '../queue/queue.constants';

@Controller('api/demo/telegram')
export class TelegramController {
  constructor(
    @InjectQueue(TELEGRAM_QUEUE) private readonly queue: Queue,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() update: TelegramWebhookPayload): Promise<{ ok: true }> {
    await this.queue.add(PROCESS_UPDATE_JOB, update, {
      jobId: update?.update_id != null ? String(update.update_id) : undefined,
      attempts: 1,
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm test -- telegram.controller`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/controllers/telegram.controller.ts src/app/controllers/telegram.controller.spec.ts
git commit -m "feat(app): webhook enqueues update and returns immediately"
```

---

## Task 6: Wire BullMQ into AppModule

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Wire the Bull module, queue, and processor**

Replace the entire contents of `src/app.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { EngineModule } from './engine';
import { TelegramWebhookNode } from './engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from './engine/nodes/telegram/send-message.node';
import { TelegramController } from './app/controllers/telegram.controller';
import { AppDbShutdown } from './app/db/db-shutdown';
import { TelegramProcessor } from './app/queue/telegram.processor';
import { TELEGRAM_QUEUE } from './app/queue/queue.constants';
import { appConfig } from './app/config';

@Module({
  imports: [
    EngineModule,
    BullModule.forRoot({
      connection: new IORedis(appConfig.redisUrl, {
        maxRetriesPerRequest: null, // required by BullMQ workers
      }),
    }),
    BullModule.registerQueue({ name: TELEGRAM_QUEUE }),
  ],
  controllers: [TelegramController],
  providers: [
    TelegramWebhookNode,
    TelegramSendMessageNode,
    AppDbShutdown,
    TelegramProcessor,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app.module.ts
git commit -m "feat(app): wire BullMQ queue and telegram processor into AppModule"
```

---

## Final verification

- [ ] **Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS (the rewritten controller spec + new processor spec included).

- [ ] **Lint**

Run: `pnpm lint`
Expected: clean (lint auto-fixes; re-stage if it modifies files).

- [ ] **Build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Note for the user (not an automated step)**

The runtime path needs a live Redis (`REDIS_URL`) and is verified by the user — do NOT start the dev server (see no-live-testing preference). Remind the user to set `REDIS_URL` (and optionally `QUEUE_CONCURRENCY`) in `.env` before running.
