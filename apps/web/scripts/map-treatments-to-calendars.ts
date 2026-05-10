import { createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, ilike } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../lib/db/schema';
import { ghlIntegrations, tenants, treatments } from '../lib/db/schema';

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

type GhlCal = { id: string; name?: string; isActive?: boolean };

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

    // 1) Listar calendarios de GHL
    const res = await fetch(
      `https://services.leadconnectorhq.com/calendars/?locationId=${locationId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: '2021-07-28',
          Accept: 'application/json',
        },
      },
    );
    const json = (await res.json()) as { calendars?: GhlCal[] };
    const calendars = json.calendars ?? [];

    if (calendars.length === 0) {
      console.log('⚠️  GHL no tiene calendarios. Creálos antes de correr esto.');
      return;
    }

    console.log(`📅 ${calendars.length} calendarios en GHL:`);
    for (const c of calendars) console.log(`   - ${c.name} (${c.id})`);

    // 2) Por cada calendario, intentar match contra treatments por nombre
    const allTreatments = await db
      .select({ id: treatments.id, name: treatments.name, currentCal: treatments.ghlCalendarId })
      .from(treatments)
      .where(eq(treatments.tenantId, tenant!.id));

    console.log(`\n🦷 ${allTreatments.length} tratamientos en DB`);

    const matches: { treatmentId: string; treatmentName: string; calendarId: string; calendarName: string }[] = [];
    let defaultCalendarId: string | null = null;
    for (const cal of calendars) {
      // "Citas generales" / "Limpieza" etc → default es el más genérico
      if (cal.name && /general|cita/i.test(cal.name)) {
        defaultCalendarId = cal.id;
      }
    }
    if (!defaultCalendarId && calendars[0]) defaultCalendarId = calendars[0].id;

    for (const t of allTreatments) {
      // Buscamos calendario cuyo nombre contiene palabras del tratamiento
      const treatmentWord = t.name.toLowerCase().split(/\s+/)[0]; // "Limpieza dental" → "limpieza"
      const exact = calendars.find((c) =>
        c.name?.toLowerCase().includes(treatmentWord ?? ''),
      );
      const calendarId = exact?.id ?? defaultCalendarId;
      const calendarName = exact?.name ?? '(default)';
      if (!calendarId) continue;

      matches.push({
        treatmentId: t.id,
        treatmentName: t.name,
        calendarId,
        calendarName,
      });
    }

    console.log('\n🔗 Mapping propuesto:');
    for (const m of matches) {
      console.log(`   ${m.treatmentName.padEnd(30)} → ${m.calendarName} (${m.calendarId})`);
    }

    // 3) Aplicar
    let updates = 0;
    for (const m of matches) {
      await db
        .update(treatments)
        .set({ ghlCalendarId: m.calendarId })
        .where(and(eq(treatments.tenantId, tenant!.id), eq(treatments.id, m.treatmentId)));
      updates++;
    }

    console.log(`\n✅ ${updates} tratamientos actualizados con su ghlCalendarId.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
