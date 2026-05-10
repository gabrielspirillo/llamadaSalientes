// Diagnostica los endpoints de contactos + appointment booking
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
  const dec = createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(authTag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
}

async function ghl(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`  ${method} ${path} → ${res.status}`);
  console.log(`  Body: ${text.slice(0, 500)}`);
  return { ok: res.ok, status: res.status, text };
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

    console.log('\n=== 1) Buscar contacto por teléfono (variante /contacts/search) ===');
    await ghl(
      token,
      'GET',
      `/contacts/search?locationId=${locationId}&phone=${encodeURIComponent('+542664654405')}`,
    );

    console.log('\n=== 2) /contacts/search/duplicate (otra variante GHL) ===');
    await ghl(
      token,
      'GET',
      `/contacts/search/duplicate?locationId=${locationId}&number=${encodeURIComponent('+542664654405')}`,
    );

    console.log('\n=== 3) /contacts/?locationId=...&query=... (más reciente) ===');
    await ghl(
      token,
      'GET',
      `/contacts/?locationId=${locationId}&query=${encodeURIComponent('+542664654405')}&limit=5`,
    );

    console.log('\n=== 4) Crear contacto de prueba ===');
    const createRes = await ghl(token, 'POST', '/contacts/', {
      locationId,
      firstName: 'Test',
      lastName: 'API',
      phone: '+542664654405',
      email: 'test-api@example.com',
    });

    if (!createRes.ok) {
      console.log('No pude crear contacto, abortando booking test');
      return;
    }
    const created = JSON.parse(createRes.text) as { contact?: { id?: string } };
    const contactId = created.contact?.id;
    console.log(`\n  → contactId creado: ${contactId}`);

    if (!contactId) return;

    // 5) Agendar cita con calendar real
    const calendarId = '5sXEYUgNQYiQcCnnNGLe'; // Limpieza dental
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setUTCHours(7, 0, 0, 0); // 09:00 Madrid (UTC+2)

    console.log('\n=== 5) POST /calendars/events/appointments ===');
    await ghl(token, 'POST', '/calendars/events/appointments', {
      calendarId,
      locationId,
      contactId,
      startTime: tomorrow.toISOString(),
      title: 'Limpieza dental — test API',
    });
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
