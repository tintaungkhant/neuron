import { Injectable, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { EngineModule, Node } from '../engine';
import {
  PROJECT_REGISTRATIONS,
  ProjectRegistry,
} from '../projects/project-registry';
import type {
  Project,
  TelegramUpdate,
  TriggerInput,
} from '../projects/project.types';
import { TelegramController } from './telegram.controller';

type DemoConfig = { token: string };

@Injectable()
class StubSayNode extends Node<{ msg: string }, void> {
  static lastInput: { msg: string } | undefined;
  execute(input: { msg: string }) {
    StubSayNode.lastInput = input;
    return Promise.resolve();
  }
}

const demoProject: Project<DemoConfig> = {
  id: 'demo',
  config: { token: 'tok' },
  workflows: {
    telegram: async function demoWf(
      input: TriggerInput<DemoConfig, TelegramUpdate>,
      ctx,
    ) {
      await ctx.run(StubSayNode, { msg: input.payload.message?.text ?? '' });
    },
  },
};

const projectWithoutTelegram: Project<DemoConfig> = {
  id: 'silent',
  config: { token: 'tok' },
  workflows: {},
};

describe('TelegramController', () => {
  let app: TestingModule;
  let server: INestApplication;

  beforeEach(async () => {
    StubSayNode.lastInput = undefined;
    app = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        StubSayNode,
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [
            demoProject as Project<unknown>,
            projectWithoutTelegram as Project<unknown>,
          ],
        },
      ],
    }).compile();
    server = app.createNestApplication();
    await server.init();
  });

  afterEach(async () => {
    await server.close();
  });

  it('runs the project telegram workflow on a known project', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(server.getHttpServer())
      .post('/api/demo/telegram/webhook')
      .send({ message: { chat: { id: 1 }, text: 'hi' } })
      .expect(200)
      .expect({ ok: true });

    expect(StubSayNode.lastInput).toEqual({ msg: 'hi' });
  });

  it('returns 404 when the project id is unknown', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(server.getHttpServer())
      .post('/api/nope/telegram/webhook')
      .send({})
      .expect(404);
  });

  it('returns 400 when the project has no telegram workflow', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await request(server.getHttpServer())
      .post('/api/silent/telegram/webhook')
      .send({})
      .expect(400);
  });

  it('returns 200 and logs when the workflow throws', async () => {
    const throwingProject: Project<DemoConfig> = {
      id: 'boom',
      config: { token: 'tok' },
      workflows: {
        // eslint-disable-next-line @typescript-eslint/require-await
        telegram: async function boomWf() {
          throw new Error('workflow failed inside');
        },
      },
    };

    const localApp = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [throwingProject as Project<unknown>],
        },
      ],
    }).compile();
    const localServer = localApp.createNestApplication();
    await localServer.init();

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await request(localServer.getHttpServer())
        .post('/api/boom/telegram/webhook')
        .send({})
        .expect(200)
        .expect({ ok: true });
    } finally {
      await localServer.close();
    }
  });

  it('injects project id and config into the workflow input', async () => {
    @Injectable()
    class CaptureNode extends Node<
      { project: { id: string; config: DemoConfig } },
      void
    > {
      static lastInput:
        | { project: { id: string; config: DemoConfig } }
        | undefined;
      execute(input: { project: { id: string; config: DemoConfig } }) {
        CaptureNode.lastInput = input;
        return Promise.resolve();
      }
    }

    const captureProject: Project<DemoConfig> = {
      id: 'capture',
      config: { token: 'secret' },
      workflows: {
        telegram: async function captureWf(input, ctx) {
          await ctx.run(CaptureNode, { project: input.project });
        },
      },
    };

    const localApp = await Test.createTestingModule({
      imports: [EngineModule],
      controllers: [TelegramController],
      providers: [
        CaptureNode,
        ProjectRegistry,
        {
          provide: PROJECT_REGISTRATIONS,
          useValue: [captureProject as Project<unknown>],
        },
      ],
    }).compile();
    const localServer = localApp.createNestApplication();
    await localServer.init();

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await request(localServer.getHttpServer())
        .post('/api/capture/telegram/webhook')
        .send({})
        .expect(200);
      expect(CaptureNode.lastInput).toEqual({
        project: { id: 'capture', config: { token: 'secret' } },
      });
    } finally {
      await localServer.close();
    }
  });
});
