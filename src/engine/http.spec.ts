import { fetchWithTimeout } from './http';

describe('fetchWithTimeout', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('passes through the response and attaches an abort signal', async () => {
    const res = new Response('ok', { status: 200 });
    fetchSpy.mockResolvedValue(res);

    const out = await fetchWithTimeout(
      'https://x/y',
      { method: 'POST' },
      5000,
      'thing',
    );

    expect(out).toBe(res);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x/y');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws a labeled timeout error when the fetch aborts', async () => {
    fetchSpy.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    );

    await expect(
      fetchWithTimeout('https://x/y', {}, 1000, 'OpenRouter'),
    ).rejects.toThrow(/OpenRouter timed out after 1000ms/);
  });

  it('rethrows non-timeout errors unchanged', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));

    await expect(
      fetchWithTimeout('https://x/y', {}, 1000, 'thing'),
    ).rejects.toThrow(/network down/);
  });
});
