import { AiAgentNode } from './agent.node';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
} from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';

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
  readonly loaded: string[] = [];
  readonly appended: { sessionId: string; messages: ChatMessage[] }[] = [];
  constructor(private readonly history: ChatMessage[] = []) {}
  load(sessionId: string): Promise<ChatMessage[]> {
    this.loaded.push(sessionId);
    return Promise.resolve(this.history);
  }
  append(sessionId: string, messages: ChatMessage[]): Promise<void> {
    this.appended.push({ sessionId, messages });
    return Promise.resolve();
  }
}

function assistant(content: string): ChatCompletionResult {
  return { message: { role: 'assistant', content } };
}

describe('AiAgentNode — core', () => {
  it('returns the assistant answer for a plain completion', async () => {
    const model = new FakeChatModel([assistant('hello there')]);

    const out = await new AiAgentNode().execute({
      payload: { input: 'hi', sessionId: 's1' },
      chatModel: model,
    });

    expect(out.output).toBe('hello there');
    expect(model.calls).toHaveLength(1);
  });

  it('sends the system prompt then the user message', async () => {
    const model = new FakeChatModel([assistant('ok')]);

    await new AiAgentNode().execute({
      payload: { input: 'question', sessionId: 's1' },
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
      payload: { input: 'now', sessionId: 'chat-9' },
      chatModel: model,
      memory,
    });

    expect(memory.loaded).toEqual(['chat-9']);
    expect(model.calls[0].messages).toEqual([
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'now' },
    ]);
    expect(memory.appended).toEqual([
      {
        sessionId: 'chat-9',
        messages: [
          { role: 'user', content: 'now' },
          { role: 'assistant', content: 'final' },
        ],
      },
    ]);
    expect(out.messages).toEqual([
      { role: 'user', content: 'now' },
      { role: 'assistant', content: 'final' },
    ]);
  });
});
