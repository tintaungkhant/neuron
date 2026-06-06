import {
  AiAgentNode,
  ClassifyNode,
  OpenRouterChatModel,
  PgChatMemory,
  type ChatMessage,
  type WorkflowFn,
} from '../../engine';
import { appConfig } from '../config';
import { stripMarkdown } from '../strip-markdown';
import { buildSystemPrompt, STAGE_OPTIONS } from './prompt';
import { CreateOrderTool } from '../tools/create-order.tool';
import { GetFaqsTool } from '../tools/get-faqs.tool';
import { GetPaymentMethodsTool } from '../tools/get-payment-methods.tool';
import { GetServicesTool } from '../tools/get-services.tool';

export interface ConversationInput {
  sessionId: string;
  chatExtId: number;
  text: string;
}

export interface ConversationOutput {
  reply: string; // final plain-text reply (markdown stripped)
  messages: ChatMessage[]; // clean turn to commit to memory after delivery
}

// The channel-agnostic business core: classify the turn's stage, run the sales
// agent with only that stage's instructions, and return its reply plus the
// clean turn to persist. Does NOT send and does NOT append memory — the channel
// commits after a successful delivery.
export const conversationWorkflow: WorkflowFn<
  ConversationInput,
  ConversationOutput
> = async function conversationWorkflow(input, wf) {
  const memory = new PgChatMemory({ sessionId: input.sessionId });
  const history = await memory.load();
  const chatModel = new OpenRouterChatModel({
    apiKey: appConfig.openRouterApiKey,
    model: appConfig.openRouterModel,
  });

  const { label: stage } = await wf.run(ClassifyNode, {
    input: input.text,
    history,
    options: STAGE_OPTIONS,
    chatModel,
  });

  const agent = await wf.run(AiAgentNode, {
    input: input.text,
    systemPrompt: buildSystemPrompt(stage),
    chatModel,
    memory,
    tools: [
      new GetServicesTool(),
      new GetPaymentMethodsTool(),
      new GetFaqsTool(),
      new CreateOrderTool({ chatExtId: input.chatExtId }),
    ],
  });

  return { reply: stripMarkdown(agent.output), messages: agent.messages };
};
