import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { ChunkMessageNode } from './nodes/ai/chunk-message.node';
import { TelegramGetFileNode } from './nodes/telegram/get-file.node';
import { GeminiUploadFileNode } from './nodes/gemini/upload-file.node';
import { GeminiReadMediaNode } from './nodes/gemini/read-media.node';
import { ExecutionStore } from './executions/execution-store';
import { DbShutdown } from './db/db-shutdown';

@Module({
  providers: [
    WorkflowEngine,
    AiAgentNode,
    ChunkMessageNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadMediaNode,
    ExecutionStore,
    DbShutdown,
  ],
  exports: [
    WorkflowEngine,
    AiAgentNode,
    ChunkMessageNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadMediaNode,
    ExecutionStore,
  ],
})
export class EngineModule {}
