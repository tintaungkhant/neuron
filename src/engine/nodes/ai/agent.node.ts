import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool } from '../../ai/tool';

export interface AiAgentInput {
  payload: { input: string; sessionId: string };
  systemPrompt?: string;
  chatModel: ChatModel;
  memory?: ChatMemory;
  tools?: AgentTool[];
  maxSteps?: number; // default 6 — loop guard against runaway tool calls
}

export interface AiAgentOutput {
  output: string; // final assistant text
  messages: ChatMessage[]; // this turn's messages: user msg + every assistant/tool msg
}

@Injectable()
export class AiAgentNode extends Node<AiAgentInput, AiAgentOutput> {
  async execute(input: AiAgentInput): Promise<AiAgentOutput> {
    const { payload, systemPrompt, chatModel, memory } = input;

    const history = memory ? await memory.load(payload.sessionId) : [];
    const userMsg: ChatMessage = { role: 'user', content: payload.input };
    const turnMessages: ChatMessage[] = [userMsg];

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...history, userMsg);

    const res = await chatModel.complete({ messages });
    messages.push(res.message);
    turnMessages.push(res.message);

    if (memory) {
      await memory.append(payload.sessionId, turnMessages);
    }

    return { output: res.message.content, messages: turnMessages };
  }
}
