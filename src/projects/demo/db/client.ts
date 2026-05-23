import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { demoConfig } from '../demo.config';
import * as schema from './schema';

export type DemoDb = NodePgDatabase<typeof schema>;

const pool = new Pool({ connectionString: demoConfig.databaseUrl });

export const demoDb: DemoDb = drizzle(pool, { schema });

let closed = false;
export async function closeDemoDb(): Promise<void> {
  if (closed) return;
  closed = true;
  await pool.end();
}
