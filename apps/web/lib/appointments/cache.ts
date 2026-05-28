import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { appointmentsCache, treatments } from '@/lib/db/schema';
import type { GhlAppointment } from '@/lib/ghl/appointments';

/**
 * Capa de escritura para la cache local `appointments_cache`. Idempotente
 * por (tenant_id, ghl_appointment_id) — la PK. Se usa desde:
 *
 *   - bookAppointment (después del POST exitoso a GHL).
 *   - Webhook GHL appointment (AppointmentCreate / Update).
 *   - sync-ghl-contact (hidratación de citas existentes cuando linkea un
 *     contacto por primera vez).
 *
 * El campo `treatment_id` se resuelve por match fuzzy contra el title.
 * Si no matchea, queda null y la UI muestra "Cita" como label.
 */
export async function upsertAppointmentCache(input: {
  tenantId: string;
  appt: GhlAppointment;
}): Promise<void> {
  const treatmentId = input.appt.title
    ? await resolveTreatmentId(input.tenantId, input.appt.title)
    : null;

  await db
    .insert(appointmentsCache)
    .values({
      tenantId: input.tenantId,
      ghlAppointmentId: input.appt.id,
      contactId: input.appt.contactId ?? null,
      calendarId: input.appt.calendarId ?? null,
      treatmentId,
      startTime: input.appt.startTime ? new Date(input.appt.startTime) : null,
      endTime: input.appt.endTime ? new Date(input.appt.endTime) : null,
      status: input.appt.appointmentStatus ?? null,
      assignedUserId: input.appt.assignedUserId ?? null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [appointmentsCache.tenantId, appointmentsCache.ghlAppointmentId],
      set: {
        contactId: input.appt.contactId ?? null,
        calendarId: input.appt.calendarId ?? null,
        treatmentId,
        startTime: input.appt.startTime ? new Date(input.appt.startTime) : null,
        endTime: input.appt.endTime ? new Date(input.appt.endTime) : null,
        status: input.appt.appointmentStatus ?? null,
        assignedUserId: input.appt.assignedUserId ?? null,
        syncedAt: new Date(),
      },
    });
}

export async function upsertAppointmentCacheMany(input: {
  tenantId: string;
  appts: GhlAppointment[];
}): Promise<number> {
  let n = 0;
  for (const appt of input.appts) {
    if (!appt.id) continue;
    await upsertAppointmentCache({ tenantId: input.tenantId, appt });
    n += 1;
  }
  return n;
}

export async function deleteAppointmentCache(input: {
  tenantId: string;
  ghlAppointmentId: string;
}): Promise<void> {
  await db
    .delete(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, input.tenantId),
        eq(appointmentsCache.ghlAppointmentId, input.ghlAppointmentId),
      ),
    );
}

/**
 * Heurística para mapear el título de un appointment a un tratamiento
 * existente del tenant. Si el title contiene alguna palabra >2 chars que
 * matchee con el nombre de un tratamiento (ILIKE), devolvemos su id.
 * No es perfecto pero alcanza para "Limpieza dental" → treatment "Limpieza".
 */
async function resolveTreatmentId(
  tenantId: string,
  title: string,
): Promise<string | null> {
  const candidate = title.trim().toLowerCase();
  if (!candidate) return null;
  const rows = await db
    .select({ id: treatments.id, name: treatments.name })
    .from(treatments)
    .where(eq(treatments.tenantId, tenantId));
  // Match por palabras significativas.
  const words = candidate.split(/\s+/).filter((w) => w.length > 2);
  for (const t of rows) {
    const name = t.name.toLowerCase();
    if (name === candidate) return t.id;
    if (words.some((w) => name.includes(w))) return t.id;
  }
  return null;
}
