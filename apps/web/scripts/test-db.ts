import path from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: path.resolve(__dirname, '../.env.local') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }
  const masked = url.replace(/:[^:@]+@/, ':****@');
  console.log('→ connecting:', masked);

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    const rows = await sql`select version() as v, current_database() as db, now() as now`;
    console.log('✅ DB OK');
    console.log(' ', rows[0]);
  } catch (err) {
    console.error('❌ DB connection failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
