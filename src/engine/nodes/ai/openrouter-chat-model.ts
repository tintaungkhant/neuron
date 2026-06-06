import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  ChatModel,
  ToolCall,
} from '../../ai/chat-model';
import type { ToolSpec } from '../../ai/tool';
import type { TokenUsage } from '../../trace';
import { fetchWithTimeout } from '../../http';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface OpenRouterChatModelOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number; // defaults to 60s
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
      arguments: parseToolArguments(c.function.name, c.function.arguments),
    }));
  }
  if (m.tool_call_id) out.toolCallId = m.tool_call_id;
  return out;
}

function parseToolArguments(
  name: string,
  raw: string,
): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    throw new Error(`OpenRouter: invalid JSON arguments for tool "${name}"`);
  }
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

function fromOpenAiUsage(u: OpenAiUsage | undefined): TokenUsage | undefined {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? 0,
  };
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

export class OpenRouterChatModel implements ChatModel {
  constructor(private readonly opts: OpenRouterChatModelOptions) {}

  async complete(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const res = await fetchWithTimeout(
      OPENROUTER_URL,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.opts.model,
          messages: req.messages.map(toOpenAiMessage),
          tools: req.tools?.map(toOpenAiTool),
        }),
      },
      this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'OpenRouter',
    );

    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: OpenAiMessage }[];
      usage?: OpenAiUsage;
    };
    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new Error('OpenRouter: no message in response');
    }
    return {
      message: fromOpenAiMessage(message),
      usage: fromOpenAiUsage(json.usage),
    };
  }
}
