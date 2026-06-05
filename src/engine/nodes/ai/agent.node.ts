import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool, ToolSpec } from '../../ai/tool';
import { sleep } from '../../sleep';

export interface AiAgentInput {
  input: string;
  systemPrompt?: string;
  chatModel: ChatModel;
  memory?: ChatMemory;
  tools?: AgentTool[];
  maxSteps?: number; // default 6 — loop guard against runaway tool calls
}

export interface AgentToolStep {
  name: string;
  input: Record<string, unknown>; // arguments the model passed
  output: unknown; // value the tool returned
  startedAt: number;
  finishedAt: number;
  status: 'ok' | 'error';
  attempts: number; // total tries (1 + retries that fired)
}

export interface AiAgentOutput {
  output: string; // final assistant text
  messages: ChatMessage[]; // this turn's messages: user msg + every assistant/tool msg
  toolSteps: AgentToolStep[]; // tools invoked this run, in call order, with in/out (for tracing)
}

@Injectable()
export class AiAgentNode extends Node<AiAgentInput, AiAgentOutput> {
  async execute(input: AiAgentInput): Promise<AiAgentOutput> {
    const { systemPrompt, chatModel, memory, tools } = input;
    const maxSteps = input.maxSteps ?? 6;

    const history = memory ? await memory.load() : [];
    const userMsg: ChatMessage = { role: 'user', content: input.input };

    // Working list — the model needs tool-call / tool-result messages within
    // this run. They are scratch: never returned, never persisted.
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

    let finalAssistant: ChatMessage | undefined;
    const toolSteps: AgentToolStep[] = [];

    for (let step = 0; step < maxSteps; step++) {
      const res = await chatModel.complete({ messages, tools: toolSpecs });
      const assistantMsg = res.message;
      messages.push(assistantMsg);

      if (!assistantMsg.toolCalls?.length) {
        finalAssistant = assistantMsg;
        break;
      }

      for (const call of assistantMsg.toolCalls) {
        const tool = tools?.find((t) => t.name === call.name);
        if (!tool) {
          throw new Error(`AiAgentNode: unknown tool "${call.name}"`);
        }
        // Run the tool, honouring its opt-in retry policy. After retries are
        // exhausted the error propagates: the turn fails and the workflow-level
        // catch-all sends the user a canned apology (no technical detail leaks
        // into the reply). Deterministic failure handling, one place.
        const maxRetries = tool.retry?.count ?? 0;
        const retryDelayMs = tool.retry?.delayMs ?? 0;
        const startedAt = Date.now();
        let attempts = 0;
        let result: unknown;
        for (;;) {
          attempts++;
          try {
            result = await tool.execute(call.arguments);
            break;
          } catch (e) {
            if (attempts > maxRetries) throw e;
            if (retryDelayMs > 0) await sleep(retryDelayMs);
          }
        }
        toolSteps.push({
          name: call.name,
          input: call.arguments,
          output: result,
          startedAt,
          finishedAt: Date.now(),
          status: 'ok',
          attempts,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    if (!finalAssistant) {
      throw new Error(
        `AiAgentNode: exceeded maxSteps (${maxSteps}) without a final answer`,
      );
    }

    // The clean turn — final human + AI text only. Tool messages stay scratch.
    // The agent does NOT persist it: the caller commits to memory only after the
    // reply is actually delivered, so a failed send never leaves the model
    // believing it said something the user never saw.
    const turn: ChatMessage[] = [
      userMsg,
      { role: 'assistant', content: finalAssistant.content },
    ];

    return {
      output: finalAssistant.content,
      messages: turn,
      toolSteps,
    };
  }
}
