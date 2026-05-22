import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { DbModule } from './db/db.module';
import { AiAgentNode } from './nodes/ai/agent.node';
import { PgChatMemory } from './nodes/ai/pg-chat-memory';

@Module({
  imports: [DbModule],
  providers: [WorkflowEngine, AiAgentNode, PgChatMemory],
  exports: [WorkflowEngine, AiAgentNode, PgChatMemory],
})
export class EngineModule {}
