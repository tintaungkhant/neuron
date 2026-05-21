import type { ToolSpec } from './tool';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[]; // present on an assistant message requesting tools
  toolCallId?: string; // present on a tool-result message: the call it answers
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
}

export interface ChatCompletionResult {
  message: ChatMessage; // the assistant message (may carry toolCalls)
}

export interface ChatModel {
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}
