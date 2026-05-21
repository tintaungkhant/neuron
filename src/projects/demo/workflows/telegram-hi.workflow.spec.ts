import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine } from '../../../engine';
import {
  TelegramWebhookNode,
  type TelegramWebhookPayload,
} from '../../../engine/nodes/telegram/webhook.node';
import { TelegramSendMessageNode } from '../../../engine/nodes/telegram/send-message.node';
import type { WorkflowInput } from '../../project.types';
import type { DemoConfig } from '../demo.config';
import { demoTelegramHiWf } from './telegram-hi.workflow';

describe('demoTelegramHiWf', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramWebhookNode, TelegramSendMessageNode],
    }).compile();
    engine = mod.get(WorkflowEngine);
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await mod.close();
  });

  it("replies 'hi' to the incoming chat", async () => {
    const input: WorkflowInput<DemoConfig, TelegramWebhookPayload> = {
      project: { id: 'demo', config: { telegramBotToken: 'TESTTOKEN' } },
      payload: {
        update_id: 1,
        message: {
          message_id: 1,
          chat: { id: 99, type: 'private' },
          date: 1700000000,
          text: 'anything',
        },
      },
    };

    const { trace } = await engine.run(demoTelegramHiWf, input);

    expect(trace.status).toBe('ok');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({
      name: 'TelegramWebhookNode',
      status: 'ok',
    });
    expect(trace.steps[1]).toMatchObject({
      name: 'TelegramSendMessageNode',
      status: 'ok',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTESTTOKEN/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: 99,
      text: 'hi',
    });
  });
});
