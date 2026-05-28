/* eslint-disable no-console */
// Backfill de waitlist_entries para citas futuras ya existentes.
//
// Recorre appointments_cache para un tenant y crea entradas para:
//   - status no cancelado
//   - tratamiento elegible (treatments.waitlist_eligible = true)
//   - start_time >= now + settings.minAppointmentDistanceDays
//
// Idempotente: el INSERT usa onConflictDoNothing sobre (tenant_id, ghl_appointment_id).
//
// Uso:
//   pnpm --filter web tsx scripts/waitlist/backfill-active-appointments.ts <tenantId>

import 'dotenv/config';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  treatments,
  waitlistEntries,
} from '@/lib/db/schema';
import { getOrCreateWaitlistSettings } from '@/lib/waitlist/settings';

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error('Uso: tsx scripts/waitlist/backfill-active-appointments.ts <tenantId>');
    process.exit(1);
  }

  const settings = await getOrCreateWaitlistSettings(tenantId);
  if (!settings.enabled) {
    console.warn('[backfill] tenant tiene waitlist desactivada, abortando');
    process.exit(0);
  }

  const minStart = new Date(
    Date.now() + settings.minAppointmentDistanceDays * 24 * 60 * 60 * 1000,
  );

  const eligibleTreatments = await db
    .select({ id: treatments.id })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.waitlistEligible, true)));
  const eligibleTreatmentIds = eligibleTreatments.map((t) => t.id);

  if (eligibleTreatmentIds.length === 0) {
    console.warn(
      '[backfill] no hay tratamientos elegibles. Activá waitlist_eligible en /dashboard/waitlist/settings.',
    );
    process.exit(0);
  }

  const candidates = await db
    .select({
      ghlAppointmentId: appointmentsCache.ghlAppointmentId,
      contactId: appointmentsCache.contactId,
      calendarId: appointmentsCache.calendarId,
      treatmentId: appointmentsCache.treatmentId,
      assignedUserId: appointmentsCache.assignedUserId,
      startTime: appointmentsCache.startTime,
      endTime: appointmentsCache.endTime,
      status: appointmentsCache.status,
    })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        inArray(appointmentsCache.treatmentId, eligibleTreatmentIds),
        gte(appointmentsCache.startTime, minStart),
        sql`(${appointmentsCache.status} IS NULL OR LOWER(${appointmentsCache.status}) NOT IN ('cancelled','canceled','no_show','noshow'))`,
      ),
    );

  console.log(`[backfill] ${candidates.length} citas candidatas`);

  let inserted = 0;
  for (const c of candidates) {
    if (!c.contactId || !c.treatmentId || !c.startTime) continue;
    const [row] = await db
      .insert(waitlistEntries)
      .values({
        tenantId,
        ghlContactId: c.contactId,
        ghlAppointmentId: c.ghlAppointmentId,
        treatmentId: c.treatmentId,
        calendarId: c.calendarId,
        assignedDentistId: c.assignedUserId,
        originalStartTime: c.startTime,
        originalEndTime: c.endTime,
        status: 'ACTIVE',
        source: 'auto',
      })
      .onConflictDoNothing({
        target: [waitlistEntries.tenantId, waitlistEntries.ghlAppointmentId],
      })
      .returning({ id: waitlistEntries.id });
    if (row) inserted++;
  }

  console.log(`[backfill] insertadas ${inserted} entradas nuevas (resto ya existían)`);
}

main().catch((err) => {
  console.error('[backfill] fatal', err);
  process.exit(1);
});
