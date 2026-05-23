import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db: Db = drizzle(pool, { schema });

let closed = false;
export async function closeDb(): Promise<void> {
  if (closed) return;
  closed = true;
  await pool.end();
}
