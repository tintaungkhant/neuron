import { Injectable } from '@nestjs/common';
import { Node } from '../../node';
import type { ChatMessage, ChatModel } from '../../ai/chat-model';
import type { ChatMemory } from '../../ai/memory';
import type { AgentTool, ToolSpec } from '../../ai/tool';
import type { TokenUsage } from '../../trace';
import { sleep } from '../../sleep';

const MAX_TOOL_RETRIES = 5; // hard cap so a tool's retry policy can't stall a turn
const DEFAULT_MAX_TURN_MS = 120_000; // wall-clock budget for the whole turn

export interface AiAgentInput {
  input: string;
  systemPrompt?: string;
  chatModel: ChatModel;
  memory?: ChatMemory;
  tools?: AgentTool[];
  maxSteps?: number; // default 6 — loop guard against runaway tool calls
  maxTurnMs?: number; // default 120s — wall-clock backstop for the whole turn
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
  usage?: TokenUsage; // summed token usage across every model call this turn
}

@Injectable()
export class AiAgentNode extends Node<AiAgentInput, AiAgentOutput> {
  async execute(input: AiAgentInput): Promise<AiAgentOutput> {
    const { systemPrompt, chatModel, memory, tools } = input;
    const maxSteps = input.maxSteps ?? 6;
    const deadline = Date.now() + (input.maxTurnMs ?? DEFAULT_MAX_TURN_MS);

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
    let usage: TokenUsage | undefined;

    for (let step = 0; step < maxSteps; step++) {
      if (Date.now() > deadline) {
        throw new Error(
          `AiAgentNode: turn exceeded ${input.maxTurnMs ?? DEFAULT_MAX_TURN_MS}ms`,
        );
      }
      const res = await chatModel.complete({ messages, tools: toolSpecs });
      if (res.usage) {
        usage = {
          promptTokens: (usage?.promptTokens ?? 0) + res.usage.promptTokens,
          completionTokens:
            (usage?.completionTokens ?? 0) + res.usage.completionTokens,
          totalTokens: (usage?.totalTokens ?? 0) + res.usage.totalTokens,
        };
      }
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
        const maxRetries = Math.min(tool.retry?.count ?? 0, MAX_TOOL_RETRIES);
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
            if (attempts > maxRetries) {
              // Name the failing tool + attempts in the propagated error so the
              // trace step records which tool broke (the failed run carries no
              // tool output otherwise).
              const reason = e instanceof Error ? e.message : String(e);
              throw new Error(
                `tool "${call.name}" failed after ${attempts} attempt(s): ${reason}`,
              );
            }
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
      usage,
    };
  }
}
