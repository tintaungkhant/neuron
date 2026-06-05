export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

/** Throw a uniform Error from a failed Gemini/Files API Response. */
export async function geminiError(
  context: string,
  res: Response,
): Promise<never> {
  const body = await res.text();
  throw new Error(`${context}: ${res.status} ${body}`);
}

export { sleep } from '../../sleep';
