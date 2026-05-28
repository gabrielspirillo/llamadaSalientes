import { type NextRequest, NextResponse } from 'next/server';

import { upsertAppointmentCache } from '@/lib/appointments/cache';
import { listAppointmentsInRange } from '@/lib/ghl/appointments';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { materializeReminders } from '@/lib/reminders/materialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/reminders/backfill (admin)
//
// Flujo:
//   1. Lista TODOS los appointments del location en GHL para el rango
//      [now, now + N días] (default 90 días, max 180).
//   2. Upsert cada uno a `appointments_cache` (idempotente por PK
//      compuesta).
//   3. Llama materializeReminders('sync') por cada cita. Si ya tiene su
//      reminder programado, la unique (tenant, appt, rule) lo dedupea.
//
// Devuelve resumen { appointmentsProcessed, scheduled, skipped, errors }.

const DEFAULT_DAYS_AHEAD = 90;
const MAX_DAYS_AHEAD = 180;
const MAX_TIMEOUT_MS = 60_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('admin');
  } catch (err) {
    if (err instanceof ReminderForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error('[reminders-backfill] auth error', err);
    return NextResponse.json(
      { error: (err as Error)?.message ?? 'Unauthorized' },
      { status: 401 },
    );
  }
  const { tenantId } = auth;

  const url = new URL(req.url);
  const daysAheadRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const daysAhead =
    Number.isFinite(daysAheadRaw) && daysAheadRaw > 0
      ? Math.min(daysAheadRaw, MAX_DAYS_AHEAD)
      : DEFAULT_DAYS_AHEAD;

  const startTimeMs = Date.now();
  const endTimeMs = startTimeMs + daysAhead * 24 * 60 * 60 * 1000;

  // 1. Listar citas en GHL.
  const appointments = await listAppointmentsInRange(tenantId, startTimeMs, endTimeMs).catch(
    (err) => {
      console.error('[reminders-backfill] listAppointmentsInRange failed', err);
      return [];
    },
  );

  if (appointments.length === 0) {
    return NextResponse.json({
      ok: true,
      appointmentsProcessed: 0,
      scheduled: 0,
      skipped: 0,
      errors: 0,
      message:
        'No se encontraron citas futuras en GHL. Verificá que el location tenga calendars con eventos en los próximos ' +
        `${daysAhead} días, o que la integración GHL del tenant esté activa.`,
      daysAhead,
    });
  }

  let scheduled = 0;
  let skipped = 0;
  let errors = 0;
  const skipReasons = new Map<string, number>();
  const startedAt = Date.now();

  for (const appt of appointments) {
    if (!appt.id) continue;
    // Cortar si pasamos del timeout del request (60s) para devolver un parcial.
    if (Date.now() - startedAt > MAX_TIMEOUT_MS) {
      console.warn('[reminders-backfill] timeout reached, returning partial result');
      break;
    }

    // 2. Upsert cache.
    try {
      await upsertAppointmentCache({ tenantId, appt });
    } catch (err) {
      errors++;
      console.warn('[reminders-backfill] cache upsert failed', {
        appointmentId: appt.id,
        err: (err as Error).message,
      });
      continue;
    }

    // 3. Materialize reminders.
    try {
      const result = await materializeReminders({
        tenantId,
        ghlAppointmentId: appt.id,
        reason: 'sync',
      });
      scheduled += result.scheduled;
      skipped += result.skipped.length;
      for (const s of result.skipped) {
        skipReasons.set(s.reason, (skipReasons.get(s.reason) ?? 0) + 1);
      }
    } catch (err) {
      errors++;
      console.warn('[reminders-backfill] materialize failed', {
        appointmentId: appt.id,
        err: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    appointmentsProcessed: appointments.length,
    scheduled,
    skipped,
    errors,
    skipReasons: Object.fromEntries(skipReasons),
    daysAhead,
  });
}
