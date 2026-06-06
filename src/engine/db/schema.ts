import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { Trace } from '../trace';

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: serial('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(), // 'user' | 'assistant'
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('agent_messages_session_idx').on(t.sessionId, t.id)],
);

export const executions = pgTable(
  'executions',
  {
    id: serial('id').primaryKey(),
    workflowName: text('workflow_name').notNull(),
    status: text('status').notNull(), // 'ok' | 'error'
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    stepCount: integer('step_count').notNull(), // recursive: nodes + tool children + sub-workflow steps
    tokensPrompt: integer('tokens_prompt').notNull().default(0),
    tokensCompletion: integer('tokens_completion').notNull().default(0),
    tokensTotal: integer('tokens_total').notNull().default(0),
    trace: jsonb('trace').notNull().$type<Trace>(), // full enriched trace, with node/tool in & out
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('executions_created_idx').on(t.createdAt)],
);
