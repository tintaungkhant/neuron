import { Injectable } from '@nestjs/common';
import { Node } from '../../node';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  last_name?: string;
  username?: string;
  title?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnail?: TelegramPhotoSize;
  thumb?: TelegramPhotoSize;
}

export interface TelegramSticker extends TelegramFile {
  emoji?: string;
  set_name?: string;
  is_animated?: boolean;
  is_video?: boolean;
  type?: 'regular' | 'mask' | 'custom_emoji';
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramFile;
  animation?: TelegramFile;
  document?: TelegramFile;
  sticker?: TelegramSticker;
  audio?: TelegramFile;
  voice?: TelegramFile;
}

export interface TelegramWebhookPayload {
  update_id: number;
  message?: TelegramMessage;
}

export type NormalizedAttachmentKind =
  | 'photo'
  | 'video'
  | 'animation'
  | 'document'
  | 'sticker'
  | 'audio'
  | 'voice';

export interface NormalizedAttachment {
  kind: NormalizedAttachmentKind;
  fileId: string;
  fileUniqueId: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  width?: number;
  height?: number;
  duration?: number;
  thumbnail?: {
    fileId: string;
    fileUniqueId: string;
    width: number;
    height: number;
    fileSize?: number;
  };
  emoji?: string;
}

export interface TelegramWebhookOutput {
  updateId: number;
  messageId: number;
  chat: {
    id: number;
    type: TelegramChat['type'];
    title?: string;
    username?: string;
  };
  from?: {
    id: number;
    isBot: boolean;
    firstName: string;
    lastName?: string;
    username?: string;
    languageCode?: string;
  };
  date: Date;
  text?: string;
  attachment?: NormalizedAttachment;
}

function pickLargestPhoto(photos: TelegramPhotoSize[]): TelegramPhotoSize {
  return photos.reduce((max, p) =>
    (p.file_size ?? p.width * p.height) >
    (max.file_size ?? max.width * max.height)
      ? p
      : max,
  );
}

function normalizeThumbnail(
  file: TelegramFile,
): NormalizedAttachment['thumbnail'] {
  const t = file.thumbnail ?? file.thumb;
  if (!t) return undefined;
  return {
    fileId: t.file_id,
    fileUniqueId: t.file_unique_id,
    width: t.width,
    height: t.height,
    fileSize: t.file_size,
  };
}

function normalizeAttachment(
  msg: TelegramMessage,
): NormalizedAttachment | undefined {
  if (msg.photo?.length) {
    const largest = pickLargestPhoto(msg.photo);
    return {
      kind: 'photo',
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      fileSize: largest.file_size,
      width: largest.width,
      height: largest.height,
    };
  }

  // animation+document duplicate => prefer animation
  if (msg.animation) {
    return {
      kind: 'animation',
      fileId: msg.animation.file_id,
      fileUniqueId: msg.animation.file_unique_id,
      fileName: msg.animation.file_name,
      mimeType: msg.animation.mime_type,
      fileSize: msg.animation.file_size,
      width: msg.animation.width,
      height: msg.animation.height,
      duration: msg.animation.duration,
      thumbnail: normalizeThumbnail(msg.animation),
    };
  }

  if (msg.video) {
    return {
      kind: 'video',
      fileId: msg.video.file_id,
      fileUniqueId: msg.video.file_unique_id,
      fileName: msg.video.file_name,
      mimeType: msg.video.mime_type,
      fileSize: msg.video.file_size,
      width: msg.video.width,
      height: msg.video.height,
      duration: msg.video.duration,
      thumbnail: normalizeThumbnail(msg.video),
    };
  }

  if (msg.sticker) {
    return {
      kind: 'sticker',
      fileId: msg.sticker.file_id,
      fileUniqueId: msg.sticker.file_unique_id,
      fileSize: msg.sticker.file_size,
      width: msg.sticker.width,
      height: msg.sticker.height,
      thumbnail: normalizeThumbnail(msg.sticker),
      emoji: msg.sticker.emoji,
    };
  }

  if (msg.audio) {
    return {
      kind: 'audio',
      fileId: msg.audio.file_id,
      fileUniqueId: msg.audio.file_unique_id,
      fileName: msg.audio.file_name,
      mimeType: msg.audio.mime_type,
      fileSize: msg.audio.file_size,
      duration: msg.audio.duration,
    };
  }

  if (msg.voice) {
    return {
      kind: 'voice',
      fileId: msg.voice.file_id,
      fileUniqueId: msg.voice.file_unique_id,
      mimeType: msg.voice.mime_type,
      fileSize: msg.voice.file_size,
      duration: msg.voice.duration,
    };
  }

  if (msg.document) {
    return {
      kind: 'document',
      fileId: msg.document.file_id,
      fileUniqueId: msg.document.file_unique_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      fileSize: msg.document.file_size,
      thumbnail: normalizeThumbnail(msg.document),
    };
  }

  return undefined;
}

@Injectable()
export class TelegramInNode extends Node<
  TelegramWebhookPayload,
  TelegramWebhookOutput
> {
  execute(input: TelegramWebhookPayload): Promise<TelegramWebhookOutput> {
    const msg = input.message;
    if (!msg) {
      throw new Error('Unsupported Telegram update: no message');
    }

    const out: TelegramWebhookOutput = {
      updateId: input.update_id,
      messageId: msg.message_id,
      chat: {
        id: msg.chat.id,
        type: msg.chat.type,
        title: msg.chat.title,
        username: msg.chat.username,
      },
      from: msg.from
        ? {
            id: msg.from.id,
            isBot: msg.from.is_bot,
            firstName: msg.from.first_name,
            lastName: msg.from.last_name,
            username: msg.from.username,
            languageCode: msg.from.language_code,
          }
        : undefined,
      date: new Date(msg.date * 1000),
      text: msg.text ?? msg.caption,
      attachment: normalizeAttachment(msg),
    };

    return Promise.resolve(out);
  }
}
