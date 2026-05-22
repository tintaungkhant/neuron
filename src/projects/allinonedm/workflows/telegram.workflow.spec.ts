import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../../engine';
import type { ChatMemory } from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { AllInOneDMConfig } from '../allinonedm.config';
import { telegramWorkflow } from './telegram.workflow';

describe('telegramWorkflow', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;
  let memory: jest.Mocked<ChatMemory>;

  beforeEach(async () => {
    memory = {
      load: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramWebhookNode, TelegramSendMessageNode],
    })
      .overrideProvider(PgChatMemory)
      .useValue(memory)
      .compile();
    engine = mod.get(WorkflowEngine);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input);
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
    const input: WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload> = {
      project: {
        id: 'allinonedm',
        config: {
          telegramBotToken: 'BOTTOKEN',
          openRouterApiKey: 'test-key',
          openRouterModel: 'openai/gpt-4o-mini',
        },
      },
      payload: {
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 555, type: 'private' },
          date: 1700000000,
          text: 'hello bot',
        },
      },
    };

    const { trace } = await engine.run(telegramWorkflow, input);

    expect(trace.status).toBe('ok');
    expect(trace.steps.map((s) => s.name)).toEqual([
      'TelegramWebhookNode',
      'AiAgentNode',
      'TelegramSendMessageNode',
    ]);

    const telegramCall = fetchSpy.mock.calls.find(([u]) =>
      String(u).includes('api.telegram.org'),
    );
    expect(telegramCall).toBeDefined();
    expect(
      JSON.parse((telegramCall![1] as RequestInit).body as string),
    ).toEqual({ chat_id: 555, text: 'agent reply' });
  });

  it('uses a project-namespaced sessionId for memory', async () => {
    const input: WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload> = {
      project: {
        id: 'allinonedm',
        config: {
          telegramBotToken: 'BOTTOKEN',
          openRouterApiKey: 'test-key',
          openRouterModel: 'openai/gpt-4o-mini',
        },
      },
      payload: {
        update_id: 1,
        message: {
          message_id: 5,
          chat: { id: 555, type: 'private' },
          date: 1700000000,
          text: 'hello bot',
        },
      },
    };

    await engine.run(telegramWorkflow, input);

    expect(memory.load).toHaveBeenCalledWith('allinonedm:555');
    expect(memory.append).toHaveBeenCalledWith('allinonedm:555', [
      { role: 'user', content: 'hello bot' },
      { role: 'assistant', content: 'agent reply' },
    ]);
  });

  it('ignores updates with no text', async () => {
    const input: WorkflowInput<AllInOneDMConfig, TelegramWebhookPayload> = {
      project: {
        id: 'allinonedm',
        config: {
          telegramBotToken: 'BOTTOKEN',
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

    const { trace } = await engine.run(telegramWorkflow, input);

    expect(trace.steps.map((s) => s.name)).toEqual(['TelegramWebhookNode']);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(memory.load).not.toHaveBeenCalled();
  });
});
