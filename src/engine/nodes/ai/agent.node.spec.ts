import { AiAgentNode } from './agent.node';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
} from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool } from '../../ai/tool';

class FakeChatModel implements ChatModel {
  readonly calls: ChatCompletionRequest[] = [];
  constructor(private readonly results: ChatCompletionResult[]) {}
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    // snapshot the request — execute() mutates the messages array after this call
    this.calls.push({ messages: [...req.messages], tools: req.tools });
    const next = this.results.shift();
    if (!next) throw new Error('FakeChatModel: no scripted result');
    return Promise.resolve(next);
  }
}

class FakeMemory implements ChatMemory {
  loadCount = 0;
  readonly appended: ChatMessage[][] = [];
  constructor(private readonly history: ChatMessage[] = []) {}
  load(): Promise<ChatMessage[]> {
    this.loadCount++;
    return Promise.resolve(this.history);
  }
  append(messages: ChatMessage[]): Promise<void> {
    this.appended.push(messages);
    return Promise.resolve();
  }
}

class FakeTool implements AgentTool {
  readonly calls: Record<string, unknown>[] = [];
  constructor(
    public readonly name: string,
    private readonly result: unknown,
    public readonly description = 'a fake tool',
    public readonly parameters: Record<string, unknown> = {
      type: 'object',
      properties: {},
    },
  ) {}
  execute(args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(args);
    return Promise.resolve(this.result);
  }
}

function assistant(content: string): ChatCompletionResult {
  return { message: { role: 'assistant', content } };
}

function toolCall(
  ...calls: { id: string; name: string; arguments: Record<string, unknown> }[]
): ChatCompletionResult {
  return { message: { role: 'assistant', content: '', toolCalls: calls } };
}

function withUsage(
  result: ChatCompletionResult,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
): ChatCompletionResult {
  return { ...result, usage };
}

describe('AiAgentNode — core', () => {
  it('returns the assistant answer for a plain completion', async () => {
    const model = new FakeChatModel([assistant('hello there')]);

    const out = await new AiAgentNode().execute({
      input: 'hi',
      chatModel: model,
    });

    expect(out.output).toBe('hello there');
    expect(model.calls).toHaveLength(1);
    expect(out.toolSteps).toEqual([]);
  });

  it('sends the system prompt then the user message', async () => {
    const model = new FakeChatModel([assistant('ok')]);

    await new AiAgentNode().execute({
      input: 'question',
      systemPrompt: 'be brief',
      chatModel: model,
    });

    expect(model.calls[0].messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('loads history but does not persist (the caller commits after send)', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
    ];
    const memory = new FakeMemory(history);
    const model = new FakeChatModel([assistant('final')]);

    const out = await new AiAgentNode().execute({
      input: 'now',
      chatModel: model,
      memory,
    });

    expect(memory.loadCount).toBe(1);
    expect(model.calls[0].messages).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'now' },
    ]);
    // the agent returns the clean turn but does NOT write it to memory
    expect(memory.appended).toEqual([]);
    expect(out.messages).toEqual([
      { role: 'user', content: 'now' },
      { role: 'assistant', content: 'final' },
    ]);
  });
});

describe('AiAgentNode — tools', () => {
  it('runs a requested tool and feeds the result back to the model', async () => {
    const weather = new FakeTool('get_weather', { tempC: 21 });
    const model = new FakeChatModel([
      toolCall({
        id: 'call-1',
        name: 'get_weather',
        arguments: { city: 'Yangon' },
      }),
      assistant('It is 21C in Yangon.'),
    ]);

    const out = await new AiAgentNode().execute({
      input: 'weather?',
      chatModel: model,
      tools: [weather],
    });

    expect(weather.calls).toEqual([{ city: 'Yangon' }]);
    expect(out.output).toBe('It is 21C in Yangon.');
    expect(out.toolSteps).toHaveLength(1);
    expect(out.toolSteps[0]).toMatchObject({
      name: 'get_weather',
      input: { city: 'Yangon' },
      output: { tempC: 21 },
      status: 'ok',
      attempts: 1,
    });
    expect(model.calls[0].tools).toEqual([
      {
        name: 'get_weather',
        description: 'a fake tool',
        parameters: { type: 'object', properties: {} },
      },
    ]);
    expect(model.calls[1].messages).toContainEqual({
      role: 'tool',
      toolCallId: 'call-1',
      content: JSON.stringify({ tempC: 21 }),
    });
  });

  it('lets a tool error propagate (handled by the workflow catch-all)', async () => {
    const boom: AgentTool = {
      name: 'boom',
      description: 'always fails',
      parameters: { type: 'object', properties: {} },
      execute: () => Promise.reject(new Error('db down')),
    };
    const model = new FakeChatModel([
      toolCall({ id: 'c1', name: 'boom', arguments: {} }),
    ]);

    await expect(
      new AiAgentNode().execute({
        input: 'hi',
        chatModel: model,
        tools: [boom],
      }),
    ).rejects.toThrow(/tool "boom" failed after 1 attempt\(s\): db down/);
  });

  it('caps a tool retry policy at the hard maximum', async () => {
    let n = 0;
    const spinner: AgentTool = {
      name: 'spinner',
      description: 'always fails, asks for many retries',
      parameters: { type: 'object', properties: {} },
      retry: { count: 1000, delayMs: 0 },
      execute: () => {
        n++;
        return Promise.reject(new Error('x'));
      },
    };
    const model = new FakeChatModel([
      toolCall({ id: 'c', name: 'spinner', arguments: {} }),
    ]);

    await expect(
      new AiAgentNode().execute({
        input: 'go',
        chatModel: model,
        tools: [spinner],
      }),
    ).rejects.toThrow();
    expect(n).toBe(6); // capped: 1 initial + 5 retries, not 1001
  });

  it('aborts a turn that exceeds the time budget', async () => {
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // deadline = 1000 + budget
      .mockReturnValue(10_000_000); // every later check is past the deadline
    const model = new FakeChatModel([assistant('hi')]);

    await expect(
      new AiAgentNode().execute({
        input: 'x',
        chatModel: model,
        maxTurnMs: 5000,
      }),
    ).rejects.toThrow(/turn exceeded 5000ms/);
    expect(model.calls).toHaveLength(0); // bailed before calling the model

    nowSpy.mockRestore();
  });

  it('retries a failing tool per its retry policy, then succeeds', async () => {
    let n = 0;
    const flaky: AgentTool = {
      name: 'flaky',
      description: 'fails twice then works',
      parameters: { type: 'object', properties: {} },
      retry: { count: 2, delayMs: 0 },
      execute: () => {
        n++;
        return n < 3
          ? Promise.reject(new Error('blip'))
          : Promise.resolve({ ok: true });
      },
    };
    const model = new FakeChatModel([
      toolCall({ id: 'c', name: 'flaky', arguments: {} }),
      assistant('done'),
    ]);

    const out = await new AiAgentNode().execute({
      input: 'go',
      chatModel: model,
      tools: [flaky],
    });

    expect(out.output).toBe('done');
    expect(n).toBe(3); // 1 initial + 2 retries
    expect(out.toolSteps[0]).toMatchObject({
      name: 'flaky',
      status: 'ok',
      attempts: 3,
    });
  });

  it('propagates after exhausting a tool retry policy', async () => {
    let n = 0;
    const always: AgentTool = {
      name: 'always',
      description: 'never works',
      parameters: { type: 'object', properties: {} },
      retry: { count: 1, delayMs: 0 },
      execute: () => {
        n++;
        return Promise.reject(new Error('nope'));
      },
    };
    const model = new FakeChatModel([
      toolCall({ id: 'c', name: 'always', arguments: {} }),
    ]);

    await expect(
      new AiAgentNode().execute({
        input: 'go',
        chatModel: model,
        tools: [always],
      }),
    ).rejects.toThrow(/nope/);
    expect(n).toBe(2); // 1 initial + 1 retry, then give up
  });

  it('throws when the model keeps calling tools past maxSteps', async () => {
    const spin = new FakeTool('spin', 'again');
    const model = new FakeChatModel(
      Array.from({ length: 10 }, () =>
        toolCall({ id: 'c', name: 'spin', arguments: {} }),
      ),
    );

    await expect(
      new AiAgentNode().execute({
        input: 'go',
        chatModel: model,
        tools: [spin],
        maxSteps: 3,
      }),
    ).rejects.toThrow(/exceeded maxSteps \(3\)/);
  });

  it('throws when the model requests a tool that is not registered', async () => {
    const model = new FakeChatModel([
      toolCall({ id: 'c', name: 'mystery', arguments: {} }),
    ]);

    await expect(
      new AiAgentNode().execute({
        input: 'go',
        chatModel: model,
        tools: [],
      }),
    ).rejects.toThrow(/unknown tool "mystery"/);
  });

  it('returns only the clean user+assistant turn, not tool messages', async () => {
    const weather = new FakeTool('get_weather', { tempC: 21 });
    const memory = new FakeMemory();
    const model = new FakeChatModel([
      toolCall({
        id: 'call-1',
        name: 'get_weather',
        arguments: { city: 'Yangon' },
      }),
      assistant('It is 21C in Yangon.'),
    ]);

    const out = await new AiAgentNode().execute({
      input: 'weather?',
      chatModel: model,
      memory,
      tools: [weather],
    });

    const cleanTurn = [
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'It is 21C in Yangon.' },
    ];
    expect(out.messages).toEqual(cleanTurn);
    expect(memory.appended).toEqual([]); // agent never persists
  });
});

describe('AiAgentNode — token usage', () => {
  it('sums usage across every model call in the turn', async () => {
    const weather = new FakeTool('get_weather', { tempC: 21 });
    const model = new FakeChatModel([
      withUsage(
        toolCall({ id: 'c1', name: 'get_weather', arguments: { city: 'YGN' } }),
        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      ),
      withUsage(assistant('21C'), {
        promptTokens: 20,
        completionTokens: 4,
        totalTokens: 24,
      }),
    ]);

    const out = await new AiAgentNode().execute({
      input: 'weather?',
      chatModel: model,
      tools: [weather],
    });

    expect(out.usage).toEqual({
      promptTokens: 30,
      completionTokens: 9,
      totalTokens: 39,
    });
  });

  it('omits usage when no model call reported any', async () => {
    const model = new FakeChatModel([assistant('hi')]);

    const out = await new AiAgentNode().execute({
      input: 'hi',
      chatModel: model,
    });

    expect(out.usage).toBeUndefined();
  });
});
