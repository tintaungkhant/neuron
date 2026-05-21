import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool, ToolSpec } from '../../ai/tool';

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
    const { payload, systemPrompt, chatModel, memory, tools } = input;
    const maxSteps = input.maxSteps ?? 6;

    const history = memory ? await memory.load(payload.sessionId) : [];
    const userMsg: ChatMessage = { role: 'user', content: payload.input };
    const turnMessages: ChatMessage[] = [userMsg];

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push(...history, userMsg);

    const toolSpecs: ToolSpec[] | undefined = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let answer: string | undefined;

    for (let step = 0; step < maxSteps; step++) {
      const res = await chatModel.complete({ messages, tools: toolSpecs });
      const assistantMsg = res.message;
      messages.push(assistantMsg);
      turnMessages.push(assistantMsg);

      if (!assistantMsg.toolCalls?.length) {
        answer = assistantMsg.content;
        break;
      }

      for (const call of assistantMsg.toolCalls) {
        const tool = tools?.find((t) => t.name === call.name);
        if (!tool) {
          throw new Error(`AiAgentNode: unknown tool "${call.name}"`);
        }
        const result = await tool.execute(call.arguments);
        const toolMsg: ChatMessage = {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result),
        };
        messages.push(toolMsg);
        turnMessages.push(toolMsg);
      }
    }

    if (answer === undefined) {
      throw new Error(
        `AiAgentNode: exceeded maxSteps (${maxSteps}) without a final answer`,
      );
    }

    if (memory) {
      await memory.append(payload.sessionId, turnMessages);
    }

    return { output: answer, messages: turnMessages };
  }
}
