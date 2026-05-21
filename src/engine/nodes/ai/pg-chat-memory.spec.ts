import { PgChatMemory } from './pg-chat-memory';
import type { DbConnection } from '../../db/client';
import type { ChatMessage } from '../../ai/chat-model';

describe('PgChatMemory.load', () => {
  it('queries the session window newest-first and returns it oldest-first', async () => {
    const rows = [
      {
        id: 2,
        sessionId: 's',
        role: 'assistant',
        content: 'second',
        createdAt: new Date(),
      },
      {
        id: 1,
        sessionId: 's',
        role: 'user',
        content: 'first',
        createdAt: new Date(),
      },
    ];
    const limit = jest.fn().mockResolvedValue(rows);
    const orderBy = jest.fn().mockReturnValue({ limit });
    const where = jest.fn().mockReturnValue({ orderBy });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const conn = { db: { select } } as unknown as DbConnection;

    const out = await new PgChatMemory(conn).load('s');

    expect(select).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(20);
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
  });
});

describe('PgChatMemory.append', () => {
  it('inserts each message as a row', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn().mockReturnValue({ values });
    const conn = { db: { insert } } as unknown as DbConnection;

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await new PgChatMemory(conn).append('chat-7', messages);

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith([
      { sessionId: 'chat-7', role: 'user', content: 'hi' },
      { sessionId: 'chat-7', role: 'assistant', content: 'hello' },
    ]);
  });

  it('does nothing when there are no messages', async () => {
    const insert = jest.fn();
    const conn = { db: { insert } } as unknown as DbConnection;

    await new PgChatMemory(conn).append('s', []);

    expect(insert).not.toHaveBeenCalled();
  });
});
