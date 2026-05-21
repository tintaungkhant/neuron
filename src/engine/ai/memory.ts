import type { ChatMessage } from './chat-model';

export interface ChatMemory {
  load(sessionId: string): Promise<ChatMessage[]>;
  append(sessionId: string, messages: ChatMessage[]): Promise<void>;
}
