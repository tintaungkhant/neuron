import { Injectable } from '@nestjs/common';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
  ToolCall,
} from '../../ai/chat-model';
import type { ToolSpec } from '../../ai/tool';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function toOpenAiMessage(m: ChatMessage): OpenAiMessage {
  const out: OpenAiMessage = { role: m.role, content: m.content };
  if (m.toolCalls?.length) {
    out.tool_calls = m.toolCalls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.arguments) },
    }));
  }
  if (m.toolCallId) out.tool_call_id = m.toolCallId;
  return out;
}

function fromOpenAiMessage(m: OpenAiMessage): ChatMessage {
  const out: ChatMessage = {
    role: m.role as ChatMessage['role'],
    content: m.content ?? '',
  };
  if (m.tool_calls?.length) {
    out.toolCalls = m.tool_calls.map<ToolCall>((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: JSON.parse(c.function.arguments || '{}') as Record<
        string,
        unknown
      >,
    }));
  }
  if (m.tool_call_id) out.toolCallId = m.tool_call_id;
  return out;
}

function toOpenAiTool(spec: ToolSpec) {
  return {
    type: 'function' as const,
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  };
}

@Injectable()
export class OpenRouterChatModel implements ChatModel {
  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const apiKey = requireEnv('OPENROUTER_API_KEY');
    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: req.messages.map(toOpenAiMessage),
        tools: req.tools?.map(toOpenAiTool),
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices: { message: OpenAiMessage }[];
    };
    return { message: fromOpenAiMessage(json.choices[0].message) };
  }
}
