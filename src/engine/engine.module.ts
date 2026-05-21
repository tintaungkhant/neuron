import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { DbModule } from './db/db.module';
import { AiAgentNode } from './nodes/ai/agent.node';
import { OpenRouterChatModel } from './nodes/ai/openrouter-chat-model';
import { PgChatMemory } from './nodes/ai/pg-chat-memory';

@Module({
  imports: [DbModule],
  providers: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
  exports: [WorkflowEngine, AiAgentNode, OpenRouterChatModel, PgChatMemory],
})
export class EngineModule {}
