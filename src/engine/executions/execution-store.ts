import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { executions } from '../db/schema';
import { enrichTrace, countSteps } from '../trace-format';
import type { Trace } from '../trace';

export interface ExecutionSummary {
  id: number;
  workflowName: string;
  status: string;
  durationMs: number;
  stepCount: number;
  createdAt: Date;
}

export interface ExecutionRecord extends ExecutionSummary {
  startedAt: Date;
  finishedAt: Date;
  trace: Trace;
}

/**
 * Persists each workflow run's trace to the engine DB so a UI can later render
 * the linear flow and drill into any node/tool's input & output. The trace is
 * enriched first (tool steps folded into `children`) so tools are first-class.
 */
@Injectable()
export class ExecutionStore {
  async save(trace: Trace): Promise<number> {
    const enriched = enrichTrace(trace);
    const [row] = await db
      .insert(executions)
      .values({
        workflowName: enriched.workflowName,
        status: enriched.status,
        startedAt: new Date(enriched.startedAt),
        finishedAt: new Date(enriched.finishedAt),
        durationMs: enriched.finishedAt - enriched.startedAt,
        stepCount: countSteps(enriched),
        trace: enriched,
      })
      .returning({ id: executions.id });
    return row.id;
  }

  async list(limit = 50): Promise<ExecutionSummary[]> {
    return db
      .select({
        id: executions.id,
        workflowName: executions.workflowName,
        status: executions.status,
        durationMs: executions.durationMs,
        stepCount: executions.stepCount,
        createdAt: executions.createdAt,
      })
      .from(executions)
      .orderBy(desc(executions.createdAt))
      .limit(limit);
  }

  async get(id: number): Promise<ExecutionRecord | null> {
    const [row] = await db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      workflowName: row.workflowName,
      status: row.status,
      durationMs: row.durationMs,
      stepCount: row.stepCount,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      trace: row.trace,
    };
  }
}
