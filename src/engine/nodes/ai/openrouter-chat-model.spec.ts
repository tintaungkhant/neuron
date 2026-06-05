import { OpenRouterChatModel } from './openrouter-chat-model';
import type { ChatCompletionRequest } from '../../ai/chat-model';

describe('OpenRouterChatModel', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function model(modelName = 'openai/gpt-4o-mini') {
    return new OpenRouterChatModel({ apiKey: 'test-key', model: modelName });
  }

  function okResponse(message: unknown): Response {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
    });
  }

  interface OpenAiRequestBody {
    model: string;
    messages: unknown[];
    tools?: unknown[];
  }

  function parseBody(init: RequestInit): OpenAiRequestBody {
    return JSON.parse(init.body as string) as OpenAiRequestBody;
  }

  it('POSTs messages and tools mapped to the OpenAI shape', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({ role: 'assistant', content: 'hi' }),
    );
    const req: ChatCompletionRequest = {
      messages: [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'lookup', arguments: { q: 'x' } }],
        },
        { role: 'tool', toolCallId: 'c1', content: '{"r":1}' },
      ],
      tools: [
        { name: 'lookup', description: 'find', parameters: { type: 'object' } },
      ],
    };

    await model('anthropic/claude-3.5-sonnet').complete(req);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    const body = parseBody(init);
    expect(body.model).toBe('anthropic/claude-3.5-sonnet');
    expect(body.messages).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"q":"x"}' },
          },
        ],
      },
      { role: 'tool', content: '{"r":1}', tool_call_id: 'c1' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'find',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('parses a tool-call response, JSON-decoding the arguments string', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-9',
            type: 'function',
            function: { name: 'get_time', arguments: '{"tz":"UTC"}' },
          },
        ],
      }),
    );

    const out = await model().complete({ messages: [] });

    expect(out.message).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-9', name: 'get_time', arguments: { tz: 'UTC' } }],
    });
  });

  it('throws when OpenRouter returns a non-OK status', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(model().complete({ messages: [] })).rejects.toThrow(
      /OpenRouter 429: rate limited/,
    );
  });

  it('throws a clear error when the response has no choices', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );

    await expect(model().complete({ messages: [] })).rejects.toThrow(
      /OpenRouter: no message in response/,
    );
  });

  it('throws a clear error when tool-call arguments are not valid JSON', async () => {
    fetchSpy.mockResolvedValue(
      okResponse({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'broken', arguments: 'not json{' },
          },
        ],
      }),
    );

    await expect(model().complete({ messages: [] })).rejects.toThrow(
      /invalid JSON arguments for tool "broken"/,
    );
  });

  it('uses the apiKey and model passed to the constructor', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'x' }));

    await new OpenRouterChatModel({
      apiKey: 'k2',
      model: 'meta-llama/llama-3',
    }).complete({ messages: [] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: 'Bearer k2' });
    expect(parseBody(init).model).toBe('meta-llama/llama-3');
  });
});
