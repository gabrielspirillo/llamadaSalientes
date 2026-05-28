import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import { appointmentsCache } from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { materializeReminders } from '@/lib/reminders/materialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/reminders/backfill (admin)
//
// Para citas que ya estaban en `appointments_cache` ANTES de configurar
// los recordatorios, este endpoint corre `materializeReminders` para cada
// una y devuelve un resumen. Procesa solo citas futuras (startTime > now).
//
// Es idempotente: si una cita ya tiene su reminder programado, el upsert
// con ON CONFLICT no duplica.

export async function POST(_req: NextRequest): Promise<NextResponse> {
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

  const rows = await db
    .select({ ghlAppointmentId: appointmentsCache.ghlAppointmentId })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        isNotNull(appointmentsCache.startTime),
        gt(appointmentsCache.startTime, new Date()),
      ),
    );

  let scheduled = 0;
  let skipped = 0;
  let errors = 0;
  const skipReasons = new Map<string, number>();

  for (const row of rows) {
    try {
      const result = await materializeReminders({
        tenantId,
        ghlAppointmentId: row.ghlAppointmentId,
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
        ghlAppointmentId: row.ghlAppointmentId,
        err: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    appointmentsProcessed: rows.length,
    scheduled,
    skipped,
    errors,
    skipReasons: Object.fromEntries(skipReasons),
  });
}
