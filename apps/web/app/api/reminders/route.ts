import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  appointmentsCache,
  reminderRules,
  reminderSkipLog,
  treatments,
} from '@/lib/db/schema';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/reminders?status=&channel=&treatmentId=&from=&to=&include=skipped
// Devuelve el pipeline de reminders del tenant para la UI.

export async function GET(req: NextRequest): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('viewer');
  } catch (err) {
    return roleErrorResponse(err);
  }
  const { tenantId } = auth;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') ?? undefined;
  const channel = sp.get('channel') ?? undefined;
  const from = sp.get('from') ? new Date(sp.get('from')!) : null;
  const to = sp.get('to') ? new Date(sp.get('to')!) : null;
  const include = sp.get('include') ?? '';

  const conds = [eq(appointmentReminders.tenantId, tenantId)];
  if (status) {
    conds.push(
      eq(
        appointmentReminders.status,
        status as (typeof appointmentReminders.$inferSelect)['status'],
      ),
    );
  }
  if (channel === 'WHATSAPP' || channel === 'VOICE') {
    conds.push(eq(appointmentReminders.channelPlanned, channel));
  }
  if (from && !Number.isNaN(from.getTime())) {
    conds.push(gte(appointmentReminders.scheduledFor, from));
  }
  if (to && !Number.isNaN(to.getTime())) {
    conds.push(lte(appointmentReminders.scheduledFor, to));
  }

  const reminders = await db
    .select({
      id: appointmentReminders.id,
      ghlAppointmentId: appointmentReminders.ghlAppointmentId,
      ruleId: appointmentReminders.ruleId,
      scheduledFor: appointmentReminders.scheduledFor,
      channelPlanned: appointmentReminders.channelPlanned,
      channelUsed: appointmentReminders.channelUsed,
      status: appointmentReminders.status,
      sentAt: appointmentReminders.sentAt,
      respondedAt: appointmentReminders.respondedAt,
      failureReason: appointmentReminders.failureReason,
      payloadSnapshot: appointmentReminders.payloadSnapshot,
    })
    .from(appointmentReminders)
    .where(and(...conds))
    .orderBy(desc(appointmentReminders.scheduledFor))
    .limit(500);

  // Enriquecer con label de regla (1 query batched).
  const ruleIds = Array.from(new Set(reminders.map((r) => r.ruleId)));
  const rulesById = new Map<string, { label: string | null; offsetMinutes: number }>();
  if (ruleIds.length > 0) {
    const rs = await db
      .select({
        id: reminderRules.id,
        label: reminderRules.label,
        offsetMinutes: reminderRules.offsetMinutes,
      })
      .from(reminderRules)
      .where(inArray(reminderRules.id, ruleIds));
    for (const r of rs) {
      rulesById.set(r.id, { label: r.label, offsetMinutes: r.offsetMinutes });
    }
  }

  // Skips enriquecidos con info de la cita (fecha + tratamiento) via LEFT
  // JOIN a appointments_cache + treatments. Si la cita ya no está en cache
  // (borrada o GC), los campos quedan null y el frontend muestra fallback.
  let skipped: Array<{
    id: string;
    ghlAppointmentId: string;
    ruleId: string | null;
    reason: string;
    details: unknown;
    createdAt: Date;
    appointmentStart: Date | null;
    treatmentName: string | null;
  }> = [];
  if (include === 'skipped') {
    skipped = await db
      .select({
        id: reminderSkipLog.id,
        ghlAppointmentId: reminderSkipLog.ghlAppointmentId,
        ruleId: reminderSkipLog.ruleId,
        reason: reminderSkipLog.reason,
        details: reminderSkipLog.details,
        createdAt: reminderSkipLog.createdAt,
        appointmentStart: appointmentsCache.startTime,
        treatmentName: treatments.name,
      })
      .from(reminderSkipLog)
      .leftJoin(
        appointmentsCache,
        and(
          eq(appointmentsCache.tenantId, reminderSkipLog.tenantId),
          eq(appointmentsCache.ghlAppointmentId, reminderSkipLog.ghlAppointmentId),
        ),
      )
      .leftJoin(treatments, eq(treatments.id, appointmentsCache.treatmentId))
      .where(eq(reminderSkipLog.tenantId, tenantId))
      .orderBy(desc(reminderSkipLog.createdAt))
      .limit(200);
  }

  return NextResponse.json({
    reminders: reminders.map((r) => ({
      ...r,
      rule: rulesById.get(r.ruleId) ?? null,
    })),
    ...(include === 'skipped' ? { skipped } : {}),
  });
}

function roleErrorResponse(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error('[reminders-api] auth error', err);
  return NextResponse.json(
    { error: (err as Error)?.message ?? 'Unauthorized' },
    { status: 401 },
  );
}
