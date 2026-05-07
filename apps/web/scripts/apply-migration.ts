import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: path.resolve(__dirname, '../../../.env.local') });

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DIRECT_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  const file = path.resolve(__dirname, '../../../supabase/migrations/0000_init.sql');
  const sqlText = fs.readFileSync(file, 'utf8');
  console.log(`→ applying ${path.basename(file)} (${sqlText.length} bytes)`);

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  try {
    await sql.unsafe(sqlText);
    console.log('✅ migration applied');

    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;
    console.log(`→ ${tables.length} tables in public schema:`);
    for (const t of tables) console.log('  ·', t.table_name);
  } catch (err) {
    console.error('❌ migration failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
