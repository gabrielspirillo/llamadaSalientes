import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  appointmentsCache,
  reminderRules,
} from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import { sendQueueEvent } from '@/lib/queue/client';
import type { StepRunner } from '@/lib/queue/step';
import { sendWhatsAppReminder, deriveContactDisplayName } from '@/lib/reminders/send-whatsapp';
import type { ReminderVars } from '@/lib/reminders/variables';

// Handler de la queue 'reminder-send'.
//
// Idempotente: chequea status==SCHEDULED antes de enviar. Si el reminder ya
// fue procesado (retry de BullMQ, race con cancel) → return.

export async function processReminderSendJob(
  data: QueueJobs['reminder-send'],
  step: StepRunner,
): Promise<{ status: 'sent' | 'skipped' | 'failed'; reason?: string }> {
  return step.run('process-reminder-send', async () => {
    const { tenantId, reminderId } = data;

    // 1. Cargar reminder + verificar status SCHEDULED.
    const [rem] = await db
      .select()
      .from(appointmentReminders)
      .where(
        and(
          eq(appointmentReminders.tenantId, tenantId),
          eq(appointmentReminders.id, reminderId),
        ),
      )
      .limit(1);

    if (!rem) return { status: 'skipped', reason: 'not_found' };
    if (rem.status !== 'SCHEDULED') {
      return { status: 'skipped', reason: `already_${rem.status.toLowerCase()}` };
    }

    // 2. Re-verificar cita: si fue cancelada o se movió antes del reminder,
    // abortamos.
    const [appt] = await db
      .select()
      .from(appointmentsCache)
      .where(
        and(
          eq(appointmentsCache.tenantId, tenantId),
          eq(appointmentsCache.ghlAppointmentId, rem.ghlAppointmentId),
        ),
      )
      .limit(1);

    if (!appt) {
      await markStatus(reminderId, 'CANCELLED', 'appointment_not_in_cache');
      return { status: 'skipped', reason: 'appointment_missing' };
    }

    const cancelledStatuses = new Set(['cancelled', 'canceled', 'no_show', 'noshow']);
    if (appt.status && cancelledStatuses.has(appt.status.toLowerCase())) {
      await markStatus(reminderId, 'CANCELLED', 'appointment_cancelled');
      return { status: 'skipped', reason: 'appointment_cancelled' };
    }

    // 3. Cargar la regla para saber si hay fallback.
    const [rule] = await db
      .select()
      .from(reminderRules)
      .where(eq(reminderRules.id, rem.ruleId))
      .limit(1);

    // 4. Extraer vars del snapshot. Rellenar reminderId real (estaba como placeholder).
    const snapshot = (rem.payloadSnapshot ?? {}) as { vars?: ReminderVars };
    const vars: ReminderVars | null = snapshot.vars
      ? { ...snapshot.vars, reminderId }
      : null;

    if (!vars) {
      await markStatus(reminderId, 'FAILED', 'no_vars_snapshot');
      return { status: 'failed', reason: 'no_vars_snapshot' };
    }

    const phone = vars.contact.phone;
    if (!phone) {
      await markStatus(reminderId, 'FAILED', 'no_phone_in_snapshot');
      return { status: 'failed', reason: 'no_phone' };
    }

    const displayName = deriveContactDisplayName(vars);

    // 5. Enviar por canal correcto.
    let externalMessageId: string | null = null;
    let externalCallId: string | null = null;

    if (rem.channelPlanned === 'WHATSAPP') {
      const result = await sendWhatsAppReminder({
        tenantId,
        reminderId,
        toPhoneE164: phone,
        vars,
        contactDisplayName: displayName,
      });
      if (!result.ok) {
        await markStatus(reminderId, 'FAILED', result.reason);
        return { status: 'failed', reason: result.reason };
      }
      externalMessageId = result.externalMessageId;
    } else if (rem.channelPlanned === 'VOICE') {
      // PR-5: implementación de send-voice. Por ahora reportamos failure.
      const { sendVoiceReminder } = await import('@/lib/reminders/send-voice').catch(
        () => ({ sendVoiceReminder: null as never }),
      );
      if (!sendVoiceReminder) {
        await markStatus(reminderId, 'FAILED', 'voice_sender_unavailable');
        return { status: 'failed', reason: 'voice_sender_unavailable' };
      }
      const result = await sendVoiceReminder({
        tenantId,
        reminderId,
        toPhoneE164: phone,
        vars,
        contactDisplayName: displayName,
        appointmentContactId: appt.contactId,
      });
      if (!result.ok) {
        await markStatus(reminderId, 'FAILED', result.reason);
        return { status: 'failed', reason: result.reason };
      }
      externalCallId = result.callId;
    } else {
      await markStatus(reminderId, 'FAILED', 'unknown_channel');
      return { status: 'failed', reason: 'unknown_channel' };
    }

    // 6. Marcar SENT.
    await db
      .update(appointmentReminders)
      .set({
        status: 'SENT',
        sentAt: new Date(),
        channelUsed: rem.channelPlanned,
        externalMessageId,
        externalCallId,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(appointmentReminders.id, reminderId));

    // 7. Encolar fallback-check si la regla lo tiene.
    if (rule?.fallbackChannel && rule?.fallbackWindowHours) {
      await sendQueueEvent(
        'reminder-fallback-check',
        { tenantId, reminderId },
        { delayMs: rule.fallbackWindowHours * 60 * 60 * 1000 },
      );
    }

    return { status: 'sent' };
  });
}

async function markStatus(
  reminderId: string,
  status: 'CANCELLED' | 'FAILED',
  reason: string,
): Promise<void> {
  await db
    .update(appointmentReminders)
    .set({ status, failureReason: reason, updatedAt: new Date() })
    .where(eq(appointmentReminders.id, reminderId));
}
