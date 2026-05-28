import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { appointmentReminders, reminderConfirmations } from '@/lib/db/schema';
import {
  removeReminderFallbackJob,
  removeReminderSendJob,
} from '@/lib/queue/client';
import { ReminderForbiddenError, requireReminderRole } from '@/lib/reminders/auth';
import { cancelFollowingReminders } from '@/lib/reminders/cancel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  action: z.enum(['confirm', 'reschedule', 'cancel']),
  note: z.string().max(500).optional(),
});

// POST /api/reminders/[id]/mark (operator+)
// Marca manualmente la confirmación / reagendar / cancelación de un reminder.
// Útil cuando el operador recibe la confirmación por otro canal (llamada
// directa a la clínica, mensaje fuera de la conversación, etc).

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let auth;
  try {
    auth = await requireReminderRole('operator');
  } catch (err) {
    return errResp(err);
  }
  const { tenantId, userId } = auth;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', issues: parsed.error.issues }, { status: 400 });
  }

  const [rem] = await db
    .select()
    .from(appointmentReminders)
    .where(and(eq(appointmentReminders.tenantId, tenantId), eq(appointmentReminders.id, id)))
    .limit(1);
  if (!rem) return NextResponse.json({ error: 'Reminder no encontrado' }, { status: 404 });

  await db.insert(reminderConfirmations).values({
    tenantId,
    reminderId: id,
    action: parsed.data.action,
    source: 'manual',
    actorUserId: userId,
    metadata: parsed.data.note ? { note: parsed.data.note } : {},
  });

  const newStatus: (typeof appointmentReminders.$inferSelect)['status'] =
    parsed.data.action === 'confirm'
      ? 'CONFIRMED'
      : parsed.data.action === 'cancel'
        ? 'CANCELLED'
        : 'RESCHEDULE_REQUESTED';

  await db
    .update(appointmentReminders)
    .set({ status: newStatus, respondedAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentReminders.id, id));

  await Promise.all([
    removeReminderSendJob(id),
    removeReminderFallbackJob(id),
    parsed.data.action === 'confirm' || parsed.data.action === 'cancel'
      ? cancelFollowingReminders({
          tenantId,
          ghlAppointmentId: rem.ghlAppointmentId,
          excludeReminderId: id,
        })
      : Promise.resolve({ cancelled: 0 }),
  ]);

  return NextResponse.json({ ok: true, status: newStatus });
}

function errResp(err: unknown): NextResponse {
  if (err instanceof ReminderForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
