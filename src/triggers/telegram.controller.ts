import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { WorkflowEngine } from '../engine';
import { ProjectRegistry } from '../projects/project-registry';

@Controller('api/:projectId/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly engine: WorkflowEngine,
    private readonly registry: ProjectRegistry,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Param('projectId') projectId: string,
    @Body() update: unknown,
  ): Promise<{ ok: true }> {
    const project = this.registry.require(projectId);
    const wf = project.workflows.telegram;
    if (!wf) {
      throw new BadRequestException(
        `project '${projectId}' has no telegram workflow`,
      );
    }

    try {
      await this.engine.run(wf, {
        project: { id: project.id, config: project.config },
        payload: update,
      });
    } catch (e) {
      this.logger.error('workflow failed', e instanceof Error ? e.stack : e);
    }
    return { ok: true };
  }
}
