import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';

@Module({
  providers: [WorkflowEngine, AiAgentNode, OpenRouterChatModel],
  exports: [WorkflowEngine, AiAgentNode, OpenRouterChatModel],
})
export class EngineModule {}
