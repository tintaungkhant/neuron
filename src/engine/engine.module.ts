import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';

@Module({
  providers: [WorkflowEngine],
  exports: [WorkflowEngine],
})
export class EngineModule {}
