import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { WorkflowEngine } from '../../../engine';
import { demoTelegramHiWf } from '../workflows/telegram-hi.workflow';
import { DemoTelegramController } from './telegram.controller';

describe('DemoTelegramController', () => {
  let app: INestApplication;
  let runMock: jest.Mock;

  beforeEach(async () => {
    runMock = jest.fn().mockResolvedValue({ result: undefined, trace: {} });
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DemoTelegramController],
      providers: [{ provide: WorkflowEngine, useValue: { run: runMock } }],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the demo telegram workflow and returns 200', async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 5, type: 'private' },
        date: 1,
        text: 'hi',
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send(update)
      .expect(200)
      .expect({ ok: true });

    expect(runMock).toHaveBeenCalledTimes(1);
    const [wf, input] = runMock.mock.calls[0] as [
      unknown,
      { project: { id: string }; payload: unknown },
    ];
    expect(wf).toBe(demoTelegramHiWf);
    expect(input.project.id).toBe('demo');
    expect(input.payload).toEqual(update);
  });

  it('returns 200 even when the workflow throws', async () => {
    runMock.mockRejectedValue(new Error('boom'));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send({})
      .expect(200)
      .expect({ ok: true });
  });
});
