import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import request from 'supertest';
import { TelegramController } from './telegram.controller';
import { TELEGRAM_QUEUE, PROCESS_UPDATE_JOB } from '../queue/queue.constants';

describe('TelegramController', () => {
  let app: INestApplication;
  let addMock: jest.Mock;

  beforeEach(async () => {
    addMock = jest.fn().mockResolvedValue(undefined);
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: getQueueToken(TELEGRAM_QUEUE), useValue: { add: addMock } },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('enqueues the update with jobId = update_id and returns 200', async () => {
    const update = {
      update_id: 42,
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

    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addMock.mock.calls[0] as [
      string,
      unknown,
      { jobId?: string; attempts?: number },
    ];
    expect(name).toBe(PROCESS_UPDATE_JOB);
    expect(data).toEqual(update);
    expect(opts.jobId).toBe('42');
    expect(opts.attempts).toBe(1);
  });

  it('still returns 200 when update_id is absent (no jobId)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send({})
      .expect(200)
      .expect({ ok: true });

    const [, , opts] = addMock.mock.calls[0] as [
      string,
      unknown,
      { jobId?: string },
    ];
    expect(opts.jobId).toBeUndefined();
  });
});
