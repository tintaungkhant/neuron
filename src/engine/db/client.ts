import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class DbConnection implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  readonly db: Db = drizzle(this.pool, { schema });

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
