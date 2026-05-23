import { desc, eq } from 'drizzle-orm';
import type { ChatMessage } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import { db } from '../../db/client';
import { agentMessages } from '../../db/schema';

const WINDOW_SIZE = 20;

export class PgChatMemory implements ChatMemory {
  async load(sessionId: string): Promise<ChatMessage[]> {
    const rows = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.id))
      .limit(WINDOW_SIZE);
    return rows
      .reverse() // oldest-first
      .map((r) => ({
        role: r.role as ChatMessage['role'],
        content: r.content,
      }));
  }

  async append(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await db.insert(agentMessages).values(
      messages.map((m) => ({
        sessionId,
        role: m.role,
        content: m.content,
      })),
    );
  }
}
