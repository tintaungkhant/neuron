import {
  GeminiReadMediaNode,
  GeminiUploadFileNode,
  type Context,
} from '../../engine';
import type { NormalizedAttachment } from '../../engine/nodes/telegram/webhook.node';

const IMAGE_PROMPT = `Describe this image for a sales assistant. If it is a payment receipt or bank transfer slip, extract the amount, sender name, date, and reference/transaction number. Otherwise describe what is shown (product, ad, screenshot, etc.) concisely.`;

const VIDEO_PROMPT = `Describe this video for a sales assistant. Summarize what happens, transcribe any speech (keep the speaker's original language), and note on-screen text, products, or anything relevant to a customer inquiry. Be concise.`;

const AUDIO_PROMPT = `Transcribe this audio for a sales assistant, keeping the speaker's original language. Then briefly note anything relevant to their inquiry (service interest, questions, payment). Be concise.`;

export interface MediaPlan {
  label: string; // how the attachment is described to the agent
  mime: string;
  prompt: string;
  slow: boolean; // video/audio need a longer upload + processing window
}

// Maps a normalized attachment to a Gemini read plan, or null for kinds we
// don't process (animation, document, sticker).
export function planMedia(att: NormalizedAttachment): MediaPlan | null {
  switch (att.kind) {
    case 'photo':
      return {
        label: 'an image',
        mime: 'image/jpeg',
        prompt: IMAGE_PROMPT,
        slow: false,
      };
    case 'video':
      return {
        label: 'a video',
        mime: att.mimeType ?? 'video/mp4',
        prompt: VIDEO_PROMPT,
        slow: true,
      };
    case 'audio':
      return {
        label: 'an audio message',
        mime: att.mimeType ?? 'audio/mpeg',
        prompt: AUDIO_PROMPT,
        slow: true,
      };
    case 'voice':
      return {
        label: 'a voice message',
        mime: att.mimeType ?? 'audio/ogg',
        prompt: AUDIO_PROMPT,
        slow: true,
      };
    default:
      return null;
  }
}

export interface ReadAttachmentParams {
  fileUrl: string;
  fileSize: number;
  plan: MediaPlan;
  geminiApiKey: string;
  geminiModel: string;
}

// Channel-agnostic: given a resolved file URL, upload to the Gemini Files API
// and read it back as text. Slow media (video/audio) gets longer windows.
export async function readAttachment(
  wf: Context,
  params: ReadAttachmentParams,
): Promise<string> {
  const { fileUrl, fileSize, plan, geminiApiKey, geminiModel } = params;
  const uploaded = await wf.run(GeminiUploadFileNode, {
    apiKey: geminiApiKey,
    url: fileUrl,
    mimeType: plan.mime,
    fileSize,
    ...(plan.slow
      ? { uploadTimeoutMs: 300_000, pollIntervalMs: 2_000, maxPollAttempts: 60 }
      : {}),
  });
  const read = await wf.run(GeminiReadMediaNode, {
    apiKey: geminiApiKey,
    model: geminiModel,
    fileUri: uploaded.fileUri,
    mimeType: plan.mime,
    prompt: plan.prompt,
    ...(plan.slow ? { timeoutMs: 120_000 } : {}),
  });
  return read.text;
}
