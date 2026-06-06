jest.mock('../../engine/nodes/ai/pg-chat-memory', () => ({
  PgChatMemory: jest.fn(),
}));

jest.mock('../db/client', () => ({
  appDb: { select: jest.fn(), insert: jest.fn() },
  closeAppDb: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EngineModule, WorkflowEngine, PgChatMemory } from '../../engine';
import { conversationWorkflow } from './conversation.workflow';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe('conversationWorkflow', () => {
  let mod: TestingModule;
  let engine: WorkflowEngine;
  let fetchSpy: jest.SpyInstance;
  let memory: { load: jest.Mock; append: jest.Mock };
  let replyContent: string;

  beforeEach(async () => {
    replyContent = 'agent reply';
    memory = {
      load: jest.fn().mockResolvedValue([]),
      append: jest.fn().mockResolvedValue(undefined),
    };
    (PgChatMemory as unknown as jest.Mock).mockImplementation(() => memory);

    mod = await Test.createTestingModule({ imports: [EngineModule] }).compile();
    engine = mod.get(WorkflowEngine);

    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((input) => {
      if (urlOf(input).startsWith('https://openrouter.ai/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                { message: { role: 'assistant', content: replyContent } },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await mod.close();
  });

  it('runs the agent and returns reply + clean turn; loads but does not append memory', async () => {
    const { result, trace } = await engine.run(conversationWorkflow, {
      sessionId: 'app:1',
      chatExtId: 1,
      text: 'hi',
    });

    expect(result.reply).toBe('agent reply');
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'agent reply' },
    ]);
    expect(PgChatMemory).toHaveBeenCalledWith({ sessionId: 'app:1' });
    expect(memory.load).toHaveBeenCalledWith();
    expect(memory.append).not.toHaveBeenCalled();
    expect(trace.steps.map((s) => s.name)).toEqual(['AiAgentNode']);
  });

  it('strips markdown from the reply', async () => {
    replyContent = '**bold** reply';
    const { result } = await engine.run(conversationWorkflow, {
      sessionId: 'app:1',
      chatExtId: 1,
      text: 'hi',
    });
    expect(result.reply).toBe('bold reply');
  });

  it('sends the Better Solutions prompt and the get_services tool to OpenRouter', async () => {
    await engine.run(conversationWorkflow, {
      sessionId: 'app:1',
      chatExtId: 1,
      text: 'hi',
    });
    const calls = fetchSpy.mock.calls as [RequestInfo | URL, RequestInit][];
    const orCall = calls.find(([u]) =>
      urlOf(u).startsWith('https://openrouter.ai/'),
    );
    const body = JSON.parse(orCall![1].body as string) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
    expect(body.messages.find((m) => m.role === 'system')?.content).toMatch(
      /Better Solutions/,
    );
    expect((body.tools ?? []).map((t) => t.function.name)).toContain(
      'get_services',
    );
  });
});
