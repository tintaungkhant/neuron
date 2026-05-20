import { SayHiNode } from './say-hi.node';

describe('SayHiNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs to the Telegram sendMessage endpoint with chat_id and text', async () => {
    fetchSpy.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const node = new SayHiNode();
    await node.execute({ botToken: 'abc123', chatId: 42, text: 'hi' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/botabc123/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: 42,
      text: 'hi',
    });
  });

  it('throws when sendMessage returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const node = new SayHiNode();
    await expect(
      node.execute({ botToken: 't', chatId: 1, text: 'x' }),
    ).rejects.toThrow(/sendMessage failed: 403 forbidden/);
  });
});
