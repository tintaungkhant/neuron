import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { TelegramGetFileNode } from './nodes/telegram/get-file.node';
import { GeminiUploadFileNode } from './nodes/gemini/upload-file.node';
import { GeminiReadImageNode } from './nodes/gemini/read-image.node';
import { ExecutionStore } from './executions/execution-store';
import { DbShutdown } from './db/db-shutdown';

@Module({
  providers: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
    ExecutionStore,
    DbShutdown,
  ],
  exports: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
    ExecutionStore,
  ],
})
export class EngineModule {}
