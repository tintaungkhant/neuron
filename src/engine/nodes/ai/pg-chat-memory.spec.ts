jest.mock('../../db/client', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
  closeDb: jest.fn(),
}));

import { db } from '../../db/client';
import { PgChatMemory } from './pg-chat-memory';
import type { ChatMessage } from '../../ai/chat-model';

const mockDb = db as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
};

beforeEach(() => {
  mockDb.select.mockReset();
  mockDb.insert.mockReset();
});

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
    mockDb.select.mockReturnValue({ from });

    const out = await new PgChatMemory().load('s');

    expect(mockDb.select).toHaveBeenCalled();
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
    mockDb.insert.mockReturnValue({ values });

    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await new PgChatMemory().append('chat-7', messages);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith([
      { sessionId: 'chat-7', role: 'user', content: 'hi' },
      { sessionId: 'chat-7', role: 'assistant', content: 'hello' },
    ]);
  });

  it('does nothing when there are no messages', async () => {
    await new PgChatMemory().append('s', []);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
