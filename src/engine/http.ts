/**
 * `fetch` with a hard timeout. Every outbound call to an external service
 * (OpenRouter, Gemini, Telegram) must use this so a hung upstream can't stall
 * a workflow — and the webhook handler — indefinitely. On timeout it throws a
 * labeled Error instead of a cryptic AbortError.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { duplex?: 'half' },
  timeoutMs: number,
  label: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError')
    ) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
}
