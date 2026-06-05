import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type AppDb = NodePgDatabase<typeof schema>;

// Business tables share the engine database (one DATABASE_URL); the engine and
// app keep separate schemas + migration histories, not separate databases.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const appDb: AppDb = drizzle(pool, { schema });

let closed = false;
export async function closeAppDb(): Promise<void> {
  if (closed) return;
  closed = true;
  await pool.end();
}
