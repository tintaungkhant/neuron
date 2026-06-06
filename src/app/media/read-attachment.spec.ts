import { planMedia, readAttachment } from './read-attachment';
import type { Context } from '../../engine';
import type { NormalizedAttachment } from '../../engine/nodes/telegram/webhook.node';

function att(kind: string): NormalizedAttachment {
  return { kind, fileId: 'f', fileUniqueId: 'u' } as NormalizedAttachment;
}

describe('planMedia', () => {
  it('maps photo to an image plan (not slow)', () => {
    const plan = planMedia(att('photo'));
    expect(plan).toMatchObject({
      label: 'an image',
      mime: 'image/jpeg',
      slow: false,
    });
  });

  it('maps video/audio/voice to slow plans', () => {
    expect(planMedia(att('video'))).toMatchObject({
      label: 'a video',
      slow: true,
    });
    expect(planMedia(att('audio'))).toMatchObject({
      label: 'an audio message',
      slow: true,
    });
    expect(planMedia(att('voice'))).toMatchObject({
      label: 'a voice message',
      slow: true,
    });
  });

  it('returns null for unsupported kinds', () => {
    expect(planMedia(att('document'))).toBeNull();
    expect(planMedia(att('animation'))).toBeNull();
    expect(planMedia(att('sticker'))).toBeNull();
  });
});

describe('readAttachment', () => {
  it('uploads then reads via the gemini nodes and returns the text', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ fileUri: 'gen://abc' }) // upload
      .mockResolvedValueOnce({ text: 'a bank slip' }); // read
    const wf = { run } as unknown as Context;

    const text = await readAttachment(wf, {
      fileUrl: 'https://tg/file',
      fileSize: 1234,
      plan: { label: 'an image', mime: 'image/jpeg', prompt: 'P', slow: false },
      geminiApiKey: 'KEY',
      geminiModel: 'gemini-x',
    });

    expect(text).toBe('a bank slip');
    expect(run).toHaveBeenCalledTimes(2);
    const uploadArg = run.mock.calls[0][1] as Record<string, unknown>;
    expect(uploadArg).toMatchObject({
      apiKey: 'KEY',
      url: 'https://tg/file',
      mimeType: 'image/jpeg',
      fileSize: 1234,
    });
    const readArg = run.mock.calls[1][1] as Record<string, unknown>;
    expect(readArg).toMatchObject({
      apiKey: 'KEY',
      model: 'gemini-x',
      fileUri: 'gen://abc',
      mimeType: 'image/jpeg',
      prompt: 'P',
    });
  });

  it('applies slow timeouts for slow media', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ fileUri: 'g' })
      .mockResolvedValueOnce({ text: 't' });
    const wf = { run } as unknown as Context;

    await readAttachment(wf, {
      fileUrl: 'u',
      fileSize: 1,
      plan: { label: 'a video', mime: 'video/mp4', prompt: 'P', slow: true },
      geminiApiKey: 'K',
      geminiModel: 'm',
    });

    const uploadArg = run.mock.calls[0][1] as Record<string, unknown>;
    expect(uploadArg).toMatchObject({
      uploadTimeoutMs: 300_000,
      pollIntervalMs: 2_000,
      maxPollAttempts: 60,
    });
    const readArg = run.mock.calls[1][1] as Record<string, unknown>;
    expect(readArg).toMatchObject({ timeoutMs: 120_000 });
  });
});
