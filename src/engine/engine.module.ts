import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { DbShutdown } from './db/db-shutdown';

@Module({
  providers: [WorkflowEngine, AiAgentNode, DbShutdown],
  exports: [WorkflowEngine, AiAgentNode],
})
export class EngineModule {}
