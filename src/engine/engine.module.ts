import { Module } from '@nestjs/common';
import { WorkflowEngine } from './engine';
import { AiAgentNode } from './nodes/ai/agent.node';
import { TelegramGetFileNode } from './nodes/telegram/get-file.node';
import { GeminiUploadFileNode } from './nodes/gemini/upload-file.node';
import { GeminiReadImageNode } from './nodes/gemini/read-image.node';
import { DbShutdown } from './db/db-shutdown';

@Module({
  providers: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
    DbShutdown,
  ],
  exports: [
    WorkflowEngine,
    AiAgentNode,
    TelegramGetFileNode,
    GeminiUploadFileNode,
    GeminiReadImageNode,
  ],
})
export class EngineModule {}
