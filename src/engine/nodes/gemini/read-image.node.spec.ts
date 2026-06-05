import { GeminiReadImageNode } from './read-image.node';

describe('GeminiReadImageNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs generateContent with file_data + text parts and returns joined text', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: 'a bank ' }, { text: 'slip' }] } },
          ],
        }),
        { status: 200 },
      ),
    );
    const node = new GeminiReadImageNode();
    const out = await node.execute({
      apiKey: 'KEY',
      model: 'gemini-2.0-flash',
      fileUri: 'https://gen/files/abc',
      mimeType: 'image/jpeg',
      prompt: 'Describe the payment slip',
    });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=KEY',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [
        {
          parts: [
            {
              file_data: {
                mime_type: 'image/jpeg',
                file_uri: 'https://gen/files/abc',
              },
            },
            { text: 'Describe the payment slip' },
          ],
        },
      ],
    });
    expect(out).toEqual({ text: 'a bank slip' });
  });

  it('throws when generateContent returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('bad', { status: 400 }));
    const node = new GeminiReadImageNode();
    await expect(
      node.execute({
        apiKey: 'K',
        model: 'm',
        fileUri: 'u',
        mimeType: 'image/jpeg',
        prompt: 'p',
      }),
    ).rejects.toThrow(/generateContent failed: 400 bad/);
  });

  it('throws when there is no candidate text (e.g. safety block)', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    const node = new GeminiReadImageNode();
    await expect(
      node.execute({
        apiKey: 'K',
        model: 'm',
        fileUri: 'u',
        mimeType: 'image/jpeg',
        prompt: 'p',
      }),
    ).rejects.toThrow(/no text/);
  });
});
