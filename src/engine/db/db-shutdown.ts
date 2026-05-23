import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { closeDb } from './client';

@Injectable()
export class DbShutdown implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await closeDb();
  }
}
