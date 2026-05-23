import { Injectable, type BeforeApplicationShutdown } from '@nestjs/common';
import { closeDemoDb } from './client';

@Injectable()
export class DemoDbShutdown implements BeforeApplicationShutdown {
  async beforeApplicationShutdown(): Promise<void> {
    await closeDemoDb();
  }
}
