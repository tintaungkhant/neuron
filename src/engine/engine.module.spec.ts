import { Test } from '@nestjs/testing';
import { EngineModule } from './engine.module';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';
import { PgChatMemory } from './nodes/ai/pg-chat-memory';

describe('EngineModule', () => {
  it('provides the engine and the built-in AI providers', async () => {
    const mod = await Test.createTestingModule({
      imports: [EngineModule],
    }).compile();

    expect(mod.get(WorkflowEngine)).toBeInstanceOf(WorkflowEngine);
    expect(mod.get(AiAgentNode)).toBeInstanceOf(AiAgentNode);
    expect(mod.get(OpenRouterChatModel)).toBeInstanceOf(OpenRouterChatModel);
    expect(mod.get(PgChatMemory)).toBeInstanceOf(PgChatMemory);

    await mod.close();
  });
});
