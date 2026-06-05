jest.mock('./gemini-http', () => {
  const actual =
    jest.requireActual<typeof import('./gemini-http')>('./gemini-http');
  return { ...actual, sleep: jest.fn().mockResolvedValue(undefined) };
});

import { GeminiUploadFileNode } from './upload-file.node';

describe('GeminiUploadFileNode', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const file = {
    name: 'files/abc',
    uri: 'https://gen.googleapis.com/files/abc',
    mimeType: 'image/jpeg',
    state: 'ACTIVE',
  };

  it('streams the source through a resumable upload and returns the file_uri', async () => {
    const srcResponse = new Response('image-bytes', { status: 200 });
    const srcBody = srcResponse.body;
    fetchSpy
      .mockResolvedValueOnce(srcResponse) // source fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      ) // start
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file }), { status: 200 }),
      ); // upload+finalize

    const node = new GeminiUploadFileNode();
    const out = await node.execute({
      apiKey: 'KEY',
      url: 'https://api.telegram.org/file/bott/photos/x.jpg',
      mimeType: 'image/jpeg',
      fileSize: 11,
      displayName: 'tg-photo',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // start request
    const [startUrl, startInit] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(startUrl).toBe(
      'https://generativelanguage.googleapis.com/upload/v1beta/files?key=KEY',
    );
    expect(startInit.headers).toMatchObject({
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': '11',
      'X-Goog-Upload-Header-Content-Type': 'image/jpeg',
    });
    expect(JSON.parse(startInit.body as string)).toEqual({
      file: { display_name: 'tg-photo' },
    });

    // upload+finalize request streams the source body
    const [uploadUrl, uploadInit] = fetchSpy.mock.calls[2] as [
      string,
      RequestInit & { duplex?: string },
    ];
    expect(uploadUrl).toBe('https://upload.example/u1');
    expect(uploadInit.headers).toMatchObject({
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    });
    expect(uploadInit.duplex).toBe('half');
    expect(uploadInit.body).toBe(srcBody); // streamed, not buffered

    expect(out).toEqual({
      fileUri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      state: 'ACTIVE',
    });
  });

  it('polls while PROCESSING until ACTIVE', async () => {
    const srcResponse = new Response('bytes', { status: 200 });
    fetchSpy
      .mockResolvedValueOnce(srcResponse) // source
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      ) // start
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ file: { ...file, state: 'PROCESSING' } }),
          { status: 200 },
        ),
      ) // upload → PROCESSING
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...file, state: 'ACTIVE' }), {
          status: 200,
        }),
      ); // poll → ACTIVE

    const node = new GeminiUploadFileNode();
    const out = await node.execute({
      apiKey: 'KEY',
      url: 'https://src/x.jpg',
      mimeType: 'image/jpeg',
      fileSize: 5,
    });

    const [pollUrl] = fetchSpy.mock.calls[3] as [string];
    expect(pollUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/files/abc?key=KEY',
    );
    expect(out.state).toBe('ACTIVE');
  });

  it('throws when the source fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/source fetch failed: 404 gone/);
  });

  it('throws when start is missing the upload URL header', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/missing x-goog-upload-url/);
  });

  it('throws when the final state is FAILED', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/u1' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { ...file, state: 'FAILED' } }), {
          status: 200,
        }),
      );
    const node = new GeminiUploadFileNode();
    await expect(
      node.execute({
        apiKey: 'K',
        url: 'https://src/x',
        mimeType: 'image/jpeg',
        fileSize: 1,
      }),
    ).rejects.toThrow(/state FAILED/);
  });
});
