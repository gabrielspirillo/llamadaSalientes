// Inspecciona el estado real de las llamadas en DB para entender qué se está
// poblando y qué no después de cada call.
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { desc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { calls, tenants } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    const [tenant] = await db.select().from(tenants).limit(1);
    if (!tenant) {
      console.log('No tenant');
      return;
    }

    const rows = await db
      .select()
      .from(calls)
      .where(eq(calls.tenantId, tenant.id))
      .orderBy(desc(calls.startedAt))
      .limit(10);

    console.log(`📞 Últimas ${rows.length} llamadas del tenant "${tenant.name}":\n`);

    for (const c of rows) {
      const cd = (c.customData ?? {}) as Record<string, unknown>;
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`ID:                ${c.id}`);
      console.log(`Retell:            ${c.retellCallId}`);
      console.log(`From / To:         ${c.fromNumber ?? '(null)'}  →  ${c.toNumber ?? '(null)'}`);
      console.log(`Status:            ${c.status ?? '(null)'}`);
      console.log(`Started / Ended:   ${c.startedAt?.toISOString() ?? '(null)'}  /  ${c.endedAt?.toISOString() ?? '(null)'}`);
      console.log(`Duration:          ${c.durationSeconds ?? '(null)'}s`);
      console.log(`Intent:            ${c.intent ?? '(null)'}`);
      console.log(`Sentiment:         ${c.sentiment ?? '(null)'}`);
      console.log(`Transferred:       ${c.transferred ?? false}`);
      console.log(`Summary:           ${c.summary ? c.summary.slice(0, 120) + (c.summary.length > 120 ? '…' : '') : '(null)'}`);
      console.log(`Transcript:        ${c.transcriptEnc ? '[' + c.transcriptEnc.length + ' chars cifrados]' : '(null)'}`);
      console.log(`Recording R2:      ${c.recordingR2Key ?? '(null)'}`);
      console.log(`GHL Contact:       ${c.ghlContactId ?? '(null)'}`);
      console.log(`CustomData:        ${Object.keys(cd).length > 0 ? JSON.stringify(cd) : '(empty)'}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nTotal: ${rows.length}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
