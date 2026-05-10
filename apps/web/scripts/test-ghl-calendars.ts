import { createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { ghlIntegrations, tenants } from '../lib/db/schema';

config({ path: path.resolve(__dirname, '../.env.local') });

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function decrypt(payload: string): string {
  const raw = process.env.ENCRYPTION_KEY!;
  const key = Buffer.from(raw, 'base64');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

async function ghlGet(token: string, path: string) {
  const url = `https://services.leadconnectorhq.com${path}`;
  console.log(`\n→ GET ${path}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  console.log(`  Status: ${res.status}`);
  console.log(`  Body: ${text.slice(0, 800)}`);
  return { ok: res.ok, status: res.status, body: text };
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL!;
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    const [tenant] = await db.select().from(tenants).limit(1);
    const [row] = await db
      .select()
      .from(ghlIntegrations)
      .where(eq(ghlIntegrations.tenantId, tenant!.id))
      .limit(1);

    const token = decrypt(row!.accessTokenEnc);
    const locationId = row!.locationId;
    console.log(`Tenant: ${tenant!.name}`);
    console.log(`Location: ${locationId}`);
    console.log(`Token prefix: ${token.slice(0, 12)}...`);

    // 1) Listar calendarios
    const calRes = await ghlGet(token, `/calendars/?locationId=${locationId}`);
    if (!calRes.ok) return;

    const cals = JSON.parse(calRes.body) as { calendars?: Array<{ id: string; name?: string }> };
    if (!cals.calendars || cals.calendars.length === 0) {
      console.log('\n⚠️  No hay calendarios creados en esta location.');
      return;
    }
    const firstCal = cals.calendars[0]!;
    console.log(`\n→ Primer calendario: ${firstCal.name ?? '(sin nombre)'} (${firstCal.id})`);

    // 2) Free slots para mañana — formato correcto: ms epoch
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const startMs = tomorrow.getTime();
    const endMs = dayAfter.getTime();

    await ghlGet(
      token,
      `/calendars/${firstCal.id}/free-slots?startDate=${startMs}&endDate=${endMs}&timezone=Europe/Madrid`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
