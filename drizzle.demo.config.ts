import './src/load-env';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/projects/demo/db/schema.ts',
  out: './drizzle-demo',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DEMO_DATABASE_URL ?? '' },
});
