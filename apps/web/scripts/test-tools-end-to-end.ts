// Replica la lógica de checkAvailability + parser de getFreeSlots
// usando fetch directo para no toparnos con el `server-only` import.
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

type GhlSlot = { startTime: string; endTime: string };

// COPIA EXACTA del parser en lib/ghl/calendars.ts
function parseSlots(data: Record<string, unknown>): GhlSlot[] {
  if (Array.isArray((data as { slots?: GhlSlot[] }).slots)) {
    return ((data as { slots: GhlSlot[] }).slots) ?? [];
  }
  const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;
  const allSlots: GhlSlot[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!dateKeyRegex.test(key)) continue;
    const day = value as { slots?: string[] };
    if (!day?.slots) continue;
    for (const startIso of day.slots) {
      const start = new Date(startIso);
      const end = new Date(start.getTime() + 30 * 60_000);
      allSlots.push({ startTime: start.toISOString(), endTime: end.toISOString() });
    }
  }
  return allSlots;
}

function formatSlots(slots: GhlSlot[]): string {
  if (slots.length === 0) return 'No hay disponibilidad en esa fecha. Proponé al paciente otra fecha.';
  const formatted = slots
    .slice(0, 4)
    .map((s) =>
      new Date(s.startTime).toLocaleString('es-ES', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Madrid',
      }),
    )
    .join(', ');
  return `Horarios disponibles: ${formatted}.`;
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
    const blanqCalId = 'pz4SqN6ndM0VxYFsV1bP'; // Blanqueamiento

    for (let offset = 1; offset <= 5; offset++) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + offset);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);

      const dateStr = day.toISOString().slice(0, 10);

      const res = await fetch(
        `https://services.leadconnectorhq.com/calendars/${blanqCalId}/free-slots?startDate=${day.getTime()}&endDate=${next.getTime()}&timezone=Europe/Madrid`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: '2021-07-28',
            Accept: 'application/json',
          },
        },
      );
      const data = (await res.json()) as Record<string, unknown>;
      const slots = parseSlots(data);
      console.log(`\n--- ${dateStr} ---`);
      console.log(`  Slots parseados: ${slots.length}`);
      console.log(`  formatSlots(): ${formatSlots(slots)}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
