import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ExecutionStore,
  type ExecutionRecord,
  type ExecutionSummary,
} from '../../engine';
import { DEV_UI_PAGE } from './dev-ui.page';

@Controller('dev')
export class DevController {
  constructor(private readonly store: ExecutionStore) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return DEV_UI_PAGE;
  }

  @Get('api/executions')
  list(@Query('limit') limit?: string): Promise<ExecutionSummary[]> {
    const n = limit ? Number(limit) : 50;
    return this.store.list(Number.isFinite(n) && n > 0 ? n : 50);
  }

  @Get('api/executions/:id')
  async get(@Param('id') id: string): Promise<ExecutionRecord> {
    const record = await this.store.get(Number(id));
    if (!record) {
      throw new NotFoundException(`execution ${id} not found`);
    }
    return record;
  }
}
