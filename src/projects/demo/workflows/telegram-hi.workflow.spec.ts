import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine } from '../../../engine';
import { TelegramInNode } from '../../../shared/nodes/telegram-in.node';
import { SayHiNode } from '../../../shared/nodes/say-hi.node';
import type { TelegramUpdate, TriggerInput } from '../../project.types';
import type { DemoConfig } from '../demo.config';
import { demoTelegramHiWf } from './telegram-hi.workflow';

describe('demoTelegramHiWf', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    mod = await Test.createTestingModule({
      imports: [EngineModule],
      providers: [TelegramInNode, SayHiNode],
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
    const input: TriggerInput<DemoConfig, TelegramUpdate> = {
      project: { id: 'demo', config: { telegramBotToken: 'TESTTOKEN' } },
      payload: { message: { chat: { id: 99 }, text: 'anything' } },
    };

    const { trace } = await engine.run(demoTelegramHiWf, input);

    expect(trace.status).toBe('ok');
    expect(trace.steps).toHaveLength(2);
    expect(trace.steps[0]).toMatchObject({
      name: 'TelegramInNode',
      status: 'ok',
    });
    expect(trace.steps[1]).toMatchObject({ name: 'SayHiNode', status: 'ok' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botTESTTOKEN/sendMessage');
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: 99,
      text: 'hi',
    });
  });
});
