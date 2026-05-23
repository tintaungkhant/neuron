jest.mock('../../../engine/nodes/ai/pg-chat-memory', () => ({
  PgChatMemory: jest.fn(),
}));

jest.mock('../db/client', () => ({
  demoDb: { select: jest.fn(), insert: jest.fn() },
  closeDemoDb: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../../engine';
import { demoDb } from '../db/client';
import { TelegramWebhookNode } from '../../../engine/nodes/telegram/webhook.node';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import { demoTelegramHiWorkflow } from './telegram-hi.workflow';

const mockDemoDb = demoDb as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('demoTelegramHiWorkflow', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;
  let memory: { load: jest.Mock; append: jest.Mock };
  let chatLookupLimit: jest.Mock;
  let chatInsertValues: jest.Mock;

  beforeEach(async () => {
    memory = {
      load: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    (PgChatMemory as unknown as jest.Mock).mockImplementation(() => memory);

    mockDemoDb.select.mockReset();
    mockDemoDb.insert.mockReset();
    chatLookupLimit = jest.fn().mockResolvedValue([]); // default: chat is new
    const where = jest.fn().mockReturnValue({ limit: chatLookupLimit });
    const from = jest.fn().mockReturnValue({ where });
    mockDemoDb.select.mockReturnValue({ from });
    chatInsertValues = jest.fn().mockResolvedValue(undefined);
    mockDemoDb.insert.mockReturnValue({ values: chatInsertValues });

    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramWebhookNode, TelegramSendMessageNode],
    }).compile();
    engine = mod.get(WorkflowEngine);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = urlOf(input);
      if (url.startsWith('https://openrouter.ai/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                { message: { role: 'assistant', content: 'agent reply' } },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await mod.close();
  });

  it('runs webhook -> agent -> send and replies with the agent output', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'hello bot',
      },
    };

    const { trace } = await engine.run(demoTelegramHiWorkflow, payload);

    expect(trace.workflowName).toBe('demoTelegramHiWorkflow');
    expect(trace.status).toBe('ok');
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'AiAgentNode',
      'TelegramSendMessageNode',
    ]);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const telegramCall = calls.find(([u]) =>
      urlOf(u).includes('api.telegram.org'),
    );
    expect(telegramCall).toBeDefined();
    expect(JSON.parse(telegramCall![1].body as string)).toEqual({
      chat_id: 99,
      text: 'agent reply',
    });
  });

  it('uses a project-namespaced sessionId for memory', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'hello bot',
      },
    };

    await engine.run(demoTelegramHiWorkflow, payload);

    expect(PgChatMemory).toHaveBeenCalledWith({ sessionId: 'demo:99' });
    expect(memory.load).toHaveBeenCalledWith();
    expect(memory.append).toHaveBeenCalledWith([
      { role: 'user', content: 'hello bot' },
      { role: 'assistant', content: 'agent reply' },
    ]);
  });

  it('sends the get_services tool spec and the Better Solutions prompt to OpenRouter', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 1,
      message: {
        message_id: 5,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'what do you offer?',
      },
    };

    await engine.run(demoTelegramHiWorkflow, payload);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const orCall = calls.find(([u]) =>
      urlOf(u).startsWith('https://openrouter.ai/'),
    );
    expect(orCall).toBeDefined();
    const body = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
      tools?: { type: string; function: { name: string } }[];
    };

    const system = body.messages.find((m) => m.role === 'system');
    expect(system?.content).toMatch(/Better Solutions/);

    const toolNames = (body.tools ?? []).map((t) => t.function.name);
    expect(toolNames).toContain('get_services');
  });

  it('ignores updates with no text but still registers the chat', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 2,
      message: {
        message_id: 6,
        chat: { id: 1, type: 'private' },
        date: 1700000000,
      },
    };

    const { trace } = await engine.run(demoTelegramHiWorkflow, payload);

    expect(trace.steps.map((s) => s.name)).toEqual(['TelegramWebhookNode']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(memory.load).not.toHaveBeenCalled();
    expect(mockDemoDb.insert).toHaveBeenCalled();
    expect(chatInsertValues).toHaveBeenCalledWith({
      extId: 1,
      name: null,
    });
  });

  it('registers a new chat using the telegram username when the user is unseen', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 3,
      message: {
        message_id: 7,
        chat: { id: 42, type: 'private' },
        from: {
          id: 7001,
          is_bot: false,
          first_name: 'Tin',
          username: 'tin_dev',
        },
        date: 1700000000,
        text: 'hi',
      },
    };

    await engine.run(demoTelegramHiWorkflow, payload);

    expect(chatLookupLimit).toHaveBeenCalledWith(1);
    expect(mockDemoDb.insert).toHaveBeenCalled();
    expect(chatInsertValues).toHaveBeenCalledWith({
      extId: 42,
      name: 'tin_dev',
    });
  });

  it('falls back to first_name when telegram username is missing', async () => {
    const payload: TelegramWebhookPayload = {
      update_id: 4,
      message: {
        message_id: 8,
        chat: { id: 43, type: 'private' },
        from: {
          id: 7002,
          is_bot: false,
          first_name: 'NoUsername',
        },
        date: 1700000000,
        text: 'hi',
      },
    };

    await engine.run(demoTelegramHiWorkflow, payload);

    expect(chatInsertValues).toHaveBeenCalledWith({
      extId: 43,
      name: 'NoUsername',
    });
  });

  it('skips chat insert when the chat already exists in the db', async () => {
    chatLookupLimit.mockResolvedValueOnce([{ id: 123 }]);

    const payload: TelegramWebhookPayload = {
      update_id: 5,
      message: {
        message_id: 9,
        chat: { id: 99, type: 'private' },
        from: {
          id: 7003,
          is_bot: false,
          first_name: 'Existing',
          username: 'existing_user',
        },
        date: 1700000000,
        text: 'hi again',
      },
    };

    await engine.run(demoTelegramHiWorkflow, payload);

    expect(mockDemoDb.insert).not.toHaveBeenCalled();
  });
});
