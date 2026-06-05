import '../../../load-env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { demoDb, closeDemoDb } from './client';

async function seed() {
  const sqlPath = resolve(process.cwd(), 'demo.sql');
  console.log(`Loading seed SQL from ${sqlPath}`);
  const rawSql = readFileSync(sqlPath, 'utf8');

  console.log('Executing seed SQL...');
  await demoDb.execute(sql.raw(rawSql));

  console.log('Seed complete.');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => closeDemoDb());
