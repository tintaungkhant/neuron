import { Test } from '@nestjs/testing';
import { EngineModule } from './engine.module';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';

describe('EngineModule', () => {
  it('provides the engine and the built-in AI providers', async () => {
    const mod = await Test.createTestingModule({
      imports: [EngineModule],
    }).compile();

    expect(mod.get(WorkflowEngine)).toBeInstanceOf(WorkflowEngine);
    expect(mod.get(AiAgentNode)).toBeInstanceOf(AiAgentNode);
    expect(mod.get(OpenRouterChatModel)).toBeInstanceOf(OpenRouterChatModel);

    await mod.close();
  });
});
