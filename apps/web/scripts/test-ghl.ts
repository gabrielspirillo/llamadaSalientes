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
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY no configurada');
  const key = Buffer.from(raw, 'base64');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DIRECT_URL/DATABASE_URL falta');

  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 30 });
  const db = drizzle(sql, { schema });

  try {
    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .limit(1);
    if (!tenant) throw new Error('No tenant');

    const [row] = await db
      .select()
      .from(ghlIntegrations)
      .where(eq(ghlIntegrations.tenantId, tenant.id))
      .limit(1);

    if (!row) {
      console.error('❌ No hay integración GHL para', tenant.name);
      process.exit(1);
    }

    const token = decrypt(row.accessTokenEnc);
    console.log(`✅ Tenant: ${tenant.name}`);
    console.log(`   Location: ${row.locationId}`);
    console.log(`   Token: ${token.slice(0, 12)}...`);
    console.log(`   Scopes: ${row.scopes}`);
    console.log(`   Expira: ${row.expiresAt.toISOString()}`);

    console.log('\n→ Probando GET /locations/:id ...');
    const res = await fetch(`https://services.leadconnectorhq.com/locations/${row.locationId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });

    const body = await res.text();
    console.log(`   Status: ${res.status}`);
    if (res.ok) {
      const json = JSON.parse(body) as { location?: { name?: string; address?: string } };
      console.log(`   ✅ Conexión OK. Clínica: ${json.location?.name ?? 'sin nombre'}`);
    } else {
      console.log(`   ❌ ${body.slice(0, 300)}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
