import './src/load-env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/app/db/schema.ts',
  out: './drizzle-app',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  // App tables live in the same database as the engine; keep a separate
  // migration-tracking table so the two histories never collide.
  migrations: { table: '__drizzle_migrations_app' },
});
