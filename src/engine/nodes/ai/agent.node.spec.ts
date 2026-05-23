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

describe('AiAgentNode — core', () => {
  it('returns the assistant answer for a plain completion', async () => {
    const model = new FakeChatModel([assistant('hello there')]);

    const out = await new AiAgentNode().execute({
      input: 'hi',
      chatModel: model,
    });

    expect(out.output).toBe('hello there');
    expect(model.calls).toHaveLength(1);
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

  it('loads history before the call and appends the turn after', async () => {
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
    expect(memory.appended).toEqual([
      [
        { role: 'user', content: 'now' },
        { role: 'assistant', content: 'final' },
      ],
    ]);
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

  it('persists only the clean user+assistant turn, not tool messages', async () => {
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
    expect(memory.appended).toEqual([cleanTurn]);
    expect(out.messages).toEqual(cleanTurn);
  });
});
