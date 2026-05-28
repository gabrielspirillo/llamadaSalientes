import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { appointmentReminders } from '@/lib/db/schema';
import { removeReminderFallbackJob, removeReminderSendJob } from '@/lib/queue/client';

// Cancela todos los reminders en estado SCHEDULED (todavía no enviados) para
// una cita dada. Idempotente. Se llama desde el webhook GHL cuando la cita se
// elimina/cancela, y desde handle-button-reply cuando el paciente confirma
// (cancelar los reminders POSTERIORES) o cancela.

export async function cancelReminders(args: {
  tenantId: string;
  ghlAppointmentId: string;
  reason?: string;
}): Promise<{ cancelled: number }> {
  // Cargar los pending para poder removerlos de la queue.
  const pending = await db
    .select({ id: appointmentReminders.id })
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        eq(appointmentReminders.ghlAppointmentId, args.ghlAppointmentId),
        eq(appointmentReminders.status, 'SCHEDULED'),
      ),
    );

  if (pending.length === 0) return { cancelled: 0 };

  await db
    .update(appointmentReminders)
    .set({
      status: 'CANCELLED',
      failureReason: args.reason ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        eq(appointmentReminders.ghlAppointmentId, args.ghlAppointmentId),
        eq(appointmentReminders.status, 'SCHEDULED'),
      ),
    );

  // Remover jobs de BullMQ (best-effort, no bloquea si el job ya corrió).
  await Promise.all(
    pending.flatMap((r) => [
      removeReminderSendJob(r.id),
      removeReminderFallbackJob(r.id),
    ]),
  );

  return { cancelled: pending.length };
}

// Cancela reminders posteriores a uno específico — útil cuando el paciente
// confirma un reminder (los siguientes no tienen sentido).
export async function cancelFollowingReminders(args: {
  tenantId: string;
  ghlAppointmentId: string;
  excludeReminderId: string;
}): Promise<{ cancelled: number }> {
  const pending = await db
    .select({ id: appointmentReminders.id })
    .from(appointmentReminders)
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        eq(appointmentReminders.ghlAppointmentId, args.ghlAppointmentId),
        eq(appointmentReminders.status, 'SCHEDULED'),
      ),
    );

  const toCancel = pending.filter((r) => r.id !== args.excludeReminderId);
  if (toCancel.length === 0) return { cancelled: 0 };

  await db
    .update(appointmentReminders)
    .set({
      status: 'CANCELLED',
      failureReason: 'confirmed_by_patient',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(appointmentReminders.tenantId, args.tenantId),
        inArray(
          appointmentReminders.id,
          toCancel.map((r) => r.id),
        ),
      ),
    );

  await Promise.all(
    toCancel.flatMap((r) => [
      removeReminderSendJob(r.id),
      removeReminderFallbackJob(r.id),
    ]),
  );

  return { cancelled: toCancel.length };
}
