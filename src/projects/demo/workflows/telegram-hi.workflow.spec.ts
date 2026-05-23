jest.mock('../../../engine/nodes/ai/pg-chat-memory', () => ({
  PgChatMemory: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../../engine';
import { TelegramWebhookNode } from '../../../engine/nodes/telegram/webhook.node';
import type { TelegramWebhookPayload } from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { DemoConfig } from '../demo.config';
import { demoTelegramHiWorkflow } from './telegram-hi.workflow';

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

  beforeEach(async () => {
    memory = {
      load: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    (PgChatMemory as unknown as jest.Mock).mockImplementation(() => memory);

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
    const input: WorkflowInput<DemoConfig, TelegramWebhookPayload> = {
      project: {
        id: 'demo',
        config: {
          telegramBotToken: 'TESTTOKEN',
          openRouterApiKey: 'test-key',
          openRouterModel: 'openai/gpt-4o-mini',
        },
      },
      payload: {
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 99, type: 'private' },
          date: 1700000000,
          text: 'hello bot',
        },
      },
    };

    const { trace } = await engine.run(demoTelegramHiWorkflow, input);

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
    const input: WorkflowInput<DemoConfig, TelegramWebhookPayload> = {
      project: {
        id: 'demo',
        config: {
          telegramBotToken: 'TESTTOKEN',
          openRouterApiKey: 'test-key',
          openRouterModel: 'openai/gpt-4o-mini',
        },
      },
      payload: {
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 99, type: 'private' },
          date: 1700000000,
          text: 'hello bot',
        },
      },
    };

    await engine.run(demoTelegramHiWorkflow, input);

    expect(memory.load).toHaveBeenCalledWith('demo:99');
    expect(memory.append).toHaveBeenCalledWith('demo:99', [
      { role: 'user', content: 'hello bot' },
      { role: 'assistant', content: 'agent reply' },
    ]);
  });

  it('ignores updates with no text', async () => {
    const input: WorkflowInput<DemoConfig, TelegramWebhookPayload> = {
      project: {
        id: 'demo',
        config: {
          telegramBotToken: 'TESTTOKEN',
          openRouterApiKey: 'test-key',
          openRouterModel: 'openai/gpt-4o-mini',
        },
      },
      payload: {
        update_id: 2,
        message: {
          message_id: 6,
          chat: { id: 1, type: 'private' },
          date: 1700000000,
        },
      },
    };

    const { trace } = await engine.run(demoTelegramHiWorkflow, input);

    expect(trace.steps.map((s) => s.name)).toEqual(['TelegramWebhookNode']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(memory.load).not.toHaveBeenCalled();
  });
});
