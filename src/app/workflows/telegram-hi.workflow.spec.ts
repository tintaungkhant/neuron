jest.mock('../../engine/nodes/ai/pg-chat-memory', () => ({
  PgChatMemory: jest.fn(),
}));

jest.mock('../db/client', () => ({
  appDb: { select: jest.fn(), insert: jest.fn() },
  closeAppDb: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../engine';
import { appDb } from '../db/client';
import { TelegramWebhookNode } from '../../engine/nodes/telegram/webhook.node';
import type { TelegramWebhookPayload } from '../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../engine/nodes/telegram/send-message.node';
import { telegramWorkflow } from './telegram-hi.workflow';

const mockAppDb = appDb as unknown as {
  select: jest.Mock;
  insert: jest.Mock;
};

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('telegramWorkflow', () => {
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

    mockAppDb.select.mockReset();
    mockAppDb.insert.mockReset();
    chatLookupLimit = jest.fn().mockResolvedValue([]); // default: chat is new
    const where = jest.fn().mockReturnValue({ limit: chatLookupLimit });
    const from = jest.fn().mockReturnValue({ where });
    mockAppDb.select.mockReturnValue({ from });
    chatInsertValues = jest.fn().mockResolvedValue(undefined);
    mockAppDb.insert.mockReturnValue({ values: chatInsertValues });

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

    const { trace } = await engine.run(telegramWorkflow, payload);

    expect(trace.workflowName).toBe('telegramWorkflow');
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

    await engine.run(telegramWorkflow, payload);

    expect(PgChatMemory).toHaveBeenCalledWith({ sessionId: 'app:99' });
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

    await engine.run(telegramWorkflow, payload);

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

    const { trace } = await engine.run(telegramWorkflow, payload);

    expect(trace.steps.map((s) => s.name)).toEqual(['TelegramWebhookNode']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(memory.load).not.toHaveBeenCalled();
    expect(mockAppDb.insert).toHaveBeenCalled();
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

    await engine.run(telegramWorkflow, payload);

    expect(chatLookupLimit).toHaveBeenCalledWith(1);
    expect(mockAppDb.insert).toHaveBeenCalled();
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

    await engine.run(telegramWorkflow, payload);

    expect(chatInsertValues).toHaveBeenCalledWith({
      extId: 43,
      name: 'NoUsername',
    });
  });

  it('reads a photo via gemini and feeds a labeled block + caption to the agent', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/getFile')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: 'photos/big.jpg', file_size: 50000 },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('/file/bot')) {
        return Promise.resolve(new Response('img-bytes', { status: 200 }));
      }
      if (url.includes('/upload/v1beta/files')) {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { 'x-goog-upload-url': 'https://up.example/x' },
          }),
        );
      }
      if (url === 'https://up.example/x') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              file: {
                name: 'files/abc',
                uri: 'https://files.example/abc',
                mimeType: 'image/jpeg',
                state: 'ACTIVE',
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes(':generateContent')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: 'a payment slip, 50000 MMK' }] },
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
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

    const payload: TelegramWebhookPayload = {
      update_id: 10,
      message: {
        message_id: 11,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        caption: 'is this ok?',
        photo: [
          {
            file_id: 'small',
            file_unique_id: 'u1',
            width: 90,
            height: 90,
            file_size: 1000,
          },
          {
            file_id: 'big',
            file_unique_id: 'u2',
            width: 1280,
            height: 1280,
            file_size: 50000,
          },
        ],
      },
    };

    const { trace } = await engine.run(telegramWorkflow, payload);

    expect(trace.status).toBe('ok');
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'TelegramGetFileNode',
      'GeminiUploadFileNode',
      'GeminiReadImageNode',
      'AiAgentNode',
      'TelegramSendMessageNode',
    ]);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];

    // getFile used the largest photo's file_id
    const getFileCall = calls.find(([u]) => urlOf(u).includes('/getFile'));
    expect(urlOf(getFileCall![0])).toContain('file_id=big');

    // upload start carried the getFile content length
    const startCall = calls.find(([u]) =>
      urlOf(u).includes('/upload/v1beta/files'),
    );
    expect(
      (startCall![1].headers as Record<string, string>)[
        'X-Goog-Upload-Header-Content-Length'
      ],
    ).toBe('50000');

    // generateContent referenced the uploaded file_uri
    const genCall = calls.find(([u]) => urlOf(u).includes(':generateContent'));
    const genBody = JSON.parse(genCall![1].body as string) as {
      contents: { parts: { file_data?: { file_uri: string } }[] }[];
    };
    expect(genBody.contents[0].parts[0].file_data?.file_uri).toBe(
      'https://files.example/abc',
    );

    // the agent received a labeled block + caption
    const orCall = calls.find(([u]) =>
      urlOf(u).startsWith('https://openrouter.ai/'),
    );
    const orBody = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
    };
    const userMsg = orBody.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe(
      '[User sent an image. Contents: a payment slip, 50000 MMK]\nis this ok?',
    );
  });

  it('reads a captionless photo and feeds only the labeled block', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.includes('/getFile')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              result: { file_path: 'photos/p.jpg', file_size: 2048 },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes('/file/bot')) {
        return Promise.resolve(new Response('bytes', { status: 200 }));
      }
      if (url.includes('/upload/v1beta/files')) {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { 'x-goog-upload-url': 'https://up.example/y' },
          }),
        );
      }
      if (url === 'https://up.example/y') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              file: {
                name: 'files/p',
                uri: 'https://files.example/p',
                mimeType: 'image/jpeg',
                state: 'ACTIVE',
              },
            }),
            { status: 200 },
          ),
        );
      }
      if (url.includes(':generateContent')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{ content: { parts: [{ text: 'a cat photo' }] } }],
            }),
            { status: 200 },
          ),
        );
      }
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

    const payload: TelegramWebhookPayload = {
      update_id: 11,
      message: {
        message_id: 12,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        photo: [
          {
            file_id: 'only',
            file_unique_id: 'u3',
            width: 800,
            height: 600,
            file_size: 2048,
          },
        ],
      },
    };

    await engine.run(telegramWorkflow, payload);

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const orCall = calls.find(([u]) =>
      urlOf(u).startsWith('https://openrouter.ai/'),
    );
    const orBody = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
    };
    const userMsg = orBody.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toBe(
      '[User sent an image. Contents: a cat photo]',
    );
  });

  it('sends a canned apology and rethrows when the turn fails', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = urlOf(input);
      if (url.startsWith('https://openrouter.ai/')) {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    });

    const payload: TelegramWebhookPayload = {
      update_id: 99,
      message: {
        message_id: 1,
        chat: { id: 99, type: 'private' },
        date: 1700000000,
        text: 'hi',
      },
    };

    await expect(engine.run(telegramWorkflow, payload)).rejects.toThrow();

    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const tgCall = calls.find(([u]) => urlOf(u).includes('api.telegram.org'));
    expect(tgCall).toBeDefined();
    const body = JSON.parse(tgCall![1].body as string) as { text: string };
    expect(body.text).toContain('တောင်းပန်'); // the canned apology, not a tech error
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

    await engine.run(telegramWorkflow, payload);

    expect(mockAppDb.insert).not.toHaveBeenCalled();
  });
});
