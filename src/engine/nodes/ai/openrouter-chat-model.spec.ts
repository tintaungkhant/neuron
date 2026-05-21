import { OpenRouterChatModel } from './openrouter-chat-model';
import type { ChatCompletionRequest } from '../../ai/chat-model';

describe('OpenRouterChatModel', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
  });

  function okResponse(message: unknown): Response {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
    });
  }

  it('POSTs messages and tools mapped to the OpenAI shape', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'hi' }));
    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-sonnet';
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

    await new OpenRouterChatModel().complete(req);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
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

    const out = await new OpenRouterChatModel().complete({ messages: [] });

    expect(out.message).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-9', name: 'get_time', arguments: { tz: 'UTC' } }],
    });
  });

  it('throws when OpenRouter returns a non-OK status', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));

    await expect(
      new OpenRouterChatModel().complete({ messages: [] }),
    ).rejects.toThrow(/OpenRouter 429: rate limited/);
  });

  it('uses the default model when OPENROUTER_MODEL is unset', async () => {
    fetchSpy.mockResolvedValue(okResponse({ role: 'assistant', content: 'x' }));

    await new OpenRouterChatModel().complete({ messages: [] });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.model).toBe('openai/gpt-4o-mini');
  });
});
