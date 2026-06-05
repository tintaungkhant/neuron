import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { closeAppDb } from './client';

@Injectable()
export class AppDbShutdown implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await closeAppDb();
  }
}
