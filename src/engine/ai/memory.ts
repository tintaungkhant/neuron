import type { ChatMessage } from './chat-model';

export interface ChatMemory {
  load(): Promise<ChatMessage[]>;
  append(messages: ChatMessage[]): Promise<void>;
}
