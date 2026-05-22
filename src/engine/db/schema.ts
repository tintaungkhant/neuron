import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

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
