# Telegram Async Queue Design

**Date:** 2026-06-06
**Status:** Approved

## Problem

The Telegram webhook currently runs the whole workflow inline
(`engine.run(...)`) before returning 200. A workflow turn can be slow (media
upload to Gemini + LLM tool loop), so the webhook blocks; Telegram may time out
and resend. The work is also tied to one HTTP request — no worker pool, no
back-pressure, no way to scale processing independently of request handling.

## Goal

Decouple receipt from processing with a Redis-backed queue:

1. The webhook enqueues the raw update and returns `{ ok: true }` immediately.
2. A pool of workers (concurrency configurable, default 5) consumes jobs and runs
   the workflow, recording each execution as today.

Per-chat FIFO ordering is **explicitly deferred** (see Out of scope).

## Decisions

- **Library:** BullMQ via `@nestjs/bullmq` (Redis). Batteries included:
  concurrency, retries, retention, Nest `@Processor` integration.
- **No retry:** `attempts: 1`. The workflow is not idempotent (sends Telegram
  messages, writes chat memory, creates orders); a retried partial run would
  duplicate side effects. The workflow's own catch-all already apologizes to the
  customer and the trace records the failure.
- **Worker pool:** concurrency from `QUEUE_CONCURRENCY` (default 5).
- **Idempotency:** `jobId = String(update.update_id)` — Telegram's unique update
  id dedupes retry-storms.

## Architecture

```
Telegram → POST /api/demo/telegram/webhook
              → queue.add(JOB_NAME, update, opts)
              → 200 { ok: true }            (instant)
                     ↓  Redis (BullMQ)
        worker pool (concurrency N)
              → engine.run(telegramWorkflow, update)
              → record execution (formatTrace log + executions.save)
```

Engine is untouched — this is entirely an app concern, consistent with
"triggers are plain NestJS; do not build a trigger/dispatcher layer in the
engine."

## Components

### Config — `src/app/config.ts`

Add to `AppConfig` / `appConfig`:

- `redisUrl: requireEnv('REDIS_URL')` — e.g. `redis://localhost:6379`.
- `queueConcurrency: number` — from `QUEUE_CONCURRENCY`, default 5. Parse with a
  small helper: `Number(process.env.QUEUE_CONCURRENCY) || 5` (non-numeric or
  unset → 5).

### Queue constants — `src/app/queue/queue.constants.ts` (new)

```ts
export const TELEGRAM_QUEUE = 'telegram';
export const PROCESS_UPDATE_JOB = 'process-update';
```

### AppModule wiring — `src/app.module.ts`

- `BullModule.forRoot({ connection })` where `connection` is an ioredis instance
  built from `appConfig.redisUrl` with `maxRetriesPerRequest: null` (required by
  BullMQ workers).
- `BullModule.registerQueue({ name: TELEGRAM_QUEUE })`.
- Register `TelegramProcessor` in `providers`.

### Controller (producer) — `src/app/controllers/telegram.controller.ts`

Becomes thin. Inject the queue with `@InjectQueue(TELEGRAM_QUEUE)`.

```ts
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
```

All `engine.run` / recording logic is removed from the controller.

### Processor (consumer) — `src/app/queue/telegram.processor.ts` (new)

```ts
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
      this.logger.error(
        'failed to save execution',
        e instanceof Error ? e.stack : e,
      );
    }
  }
}
```

The `record` helper is the same logic moved verbatim from the old controller.

### Shutdown

`@nestjs/bullmq` closes the worker on module destroy; `enableShutdownHooks()`
is already called in `main.ts`. No new shutdown provider needed. The ioredis
connection used by BullModule is closed by the module's own lifecycle.

## Environment

Add `REDIS_URL` (required) and `QUEUE_CONCURRENCY` (optional, default 5) to the
documented env keys. Tests that need the queue mock BullMQ, so they don't
require a live Redis (see Testing).

## Dependencies

`pnpm add @nestjs/bullmq bullmq ioredis`

## Testing (unit, mocked — no live Redis)

- **Controller** (`telegram.controller.spec.ts`, rewritten): provide a mock
  queue via `{ provide: getQueueToken(TELEGRAM_QUEUE), useValue: { add: jest.fn() } }`.
  Assert `webhook` returns `{ ok: true }` and calls `queue.add` with
  `PROCESS_UPDATE_JOB`, the update body, and `jobId = String(update_id)`.
- **Processor** (`telegram.processor.spec.ts`, new): construct
  `new TelegramProcessor(engineMock, storeMock)` directly.
  - happy path: `process({ data: update })` calls `engine.run` with
    `telegramWorkflow` + `update`, then `executions.save(trace)`.
  - failure path: `engine.run` rejects with a `WorkflowError` carrying a trace →
    `executions.save` called with `e.trace`, and `process` rethrows.

No e2e/live test — the user verifies the real Redis round-trip themselves.

## Out of scope (deferred)

- **Per-chat FIFO ordering.** Today, two messages from the same chat can be
  picked up by different workers and processed concurrently / out of order.
  Adding strict per-chat ordering later needs BullMQ groups (Pro) or a per-chat
  Redis lock; tracked as future work.
- Dead-letter handling beyond BullMQ's failed-job retention.
- Rate limiting against OpenRouter/Gemini.
