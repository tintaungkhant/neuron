import { desc, eq } from 'drizzle-orm';
import type { ChatMessage } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import { db } from '../../db/client';
import { agentMessages } from '../../db/schema';

const DEFAULT_WINDOW_SIZE = 20;

export type PgChatMemoryOptions = {
  sessionId: string;
  windowSize?: number;
};

export class PgChatMemory implements ChatMemory {
  private readonly sessionId: string;
  private readonly windowSize: number;

  constructor(opts: PgChatMemoryOptions) {
    this.sessionId = opts.sessionId;
    this.windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  }

  async load(): Promise<ChatMessage[]> {
    const rows = await db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, this.sessionId))
      .orderBy(desc(agentMessages.id))
      .limit(this.windowSize);
    return rows
      .reverse() // oldest-first
      .map((r) => ({
        role: r.role as ChatMessage['role'],
        content: r.content,
      }));
  }

  async append(messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return;
    await db.insert(agentMessages).values(
      messages.map((m) => ({
        sessionId: this.sessionId,
        role: m.role,
        content: m.content,
      })),
    );
  }
}
