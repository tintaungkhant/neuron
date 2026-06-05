import { TelegramGetFileNode } from './get-file.node';

describe('TelegramGetFileNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('calls getFile and builds the download URL', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { file_path: 'photos/file_1.jpg', file_size: 1234 },
        }),
        { status: 200 },
      ),
    );
    const node = new TelegramGetFileNode();
    const out = await node.execute({ botToken: 'abc', fileId: 'XYZ' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string];
    expect(url).toBe('https://api.telegram.org/botabc/getFile?file_id=XYZ');
    expect(out).toEqual({
      url: 'https://api.telegram.org/file/botabc/photos/file_1.jpg',
      filePath: 'photos/file_1.jpg',
      fileSize: 1234,
    });
  });

  it('throws when getFile returns non-2xx', async () => {
    fetchSpy.mockResolvedValue(new Response('nope', { status: 404 }));
    const node = new TelegramGetFileNode();
    await expect(node.execute({ botToken: 't', fileId: 'f' })).rejects.toThrow(
      /getFile failed: 404 nope/,
    );
  });

  it('throws when response has no file_path', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    const node = new TelegramGetFileNode();
    await expect(node.execute({ botToken: 't', fileId: 'f' })).rejects.toThrow(
      /no file_path/,
    );
  });
});
