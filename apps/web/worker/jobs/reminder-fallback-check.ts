import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  appointmentsCache,
  reminderConfirmations,
  reminderRules,
} from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import type { StepRunner } from '@/lib/queue/step';
import { sendVoiceReminder } from '@/lib/reminders/send-voice';
import { sendWhatsAppReminder, deriveContactDisplayName } from '@/lib/reminders/send-whatsapp';
import type { ReminderVars } from '@/lib/reminders/variables';

// Handler de la queue 'reminder-fallback-check'.
//
// Se encola al terminar un send exitoso si la regla tiene fallbackChannel.
// Cuando dispara (delay = fallbackWindowHours), revisa si el paciente
// respondió. Si NO hay confirmación → manda por el canal fallback.
// Si SÍ respondió (cualquier acción) → no hace nada.

export async function processReminderFallbackCheckJob(
  data: QueueJobs['reminder-fallback-check'],
  step: StepRunner,
): Promise<{ status: 'fallback_sent' | 'skipped' | 'failed'; reason?: string }> {
  return step.run('process-reminder-fallback-check', async () => {
    const { tenantId, reminderId } = data;

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
    // Solo aplica si está en SENT (recibió WA/llamada y ahora esperamos).
    if (rem.status !== 'SENT') {
      return { status: 'skipped', reason: `already_${rem.status.toLowerCase()}` };
    }

    // ¿Hay confirmación recibida?
    const confirmations = await db
      .select({ id: reminderConfirmations.id })
      .from(reminderConfirmations)
      .where(eq(reminderConfirmations.reminderId, reminderId))
      .limit(1);
    if (confirmations.length > 0) return { status: 'skipped', reason: 'already_responded' };

    // Cargar regla para conocer fallbackChannel.
    const [rule] = await db
      .select()
      .from(reminderRules)
      .where(eq(reminderRules.id, rem.ruleId))
      .limit(1);
    if (!rule?.fallbackChannel) {
      // Sin canal de fallback el recordatorio muere sin respuesta: la única
      // recuperación posible es que alguien levante el teléfono.
      const { onReminderNoResponse } = await import('@/lib/tasks/hooks');
      await onReminderNoResponse({ tenantId, reminderId });
      await publishReminderNoResponse(tenantId, reminderId);
      return { status: 'skipped', reason: 'no_fallback' };
    }

    // Re-verificar cita.
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
    if (!appt) return { status: 'skipped', reason: 'appointment_missing' };

    const cancelledStatuses = new Set(['cancelled', 'canceled', 'no_show', 'noshow']);
    if (appt.status && cancelledStatuses.has(appt.status.toLowerCase())) {
      return { status: 'skipped', reason: 'appointment_cancelled' };
    }

    // Vars del snapshot.
    const snapshot = (rem.payloadSnapshot ?? {}) as { vars?: ReminderVars };
    const vars: ReminderVars | null = snapshot.vars
      ? { ...snapshot.vars, reminderId }
      : null;
    if (!vars || !vars.contact.phone) return { status: 'failed', reason: 'no_vars' };

    const displayName = deriveContactDisplayName(vars);
    const fbChannel = rule.fallbackChannel;

    if (fbChannel === 'WHATSAPP') {
      const result = await sendWhatsAppReminder({
        tenantId,
        reminderId,
        toPhoneE164: vars.contact.phone,
        vars,
        contactDisplayName: displayName,
      });
      if (!result.ok) {
        await markFallbackFailed(reminderId, result.reason);
        const { onReminderNoResponse } = await import('@/lib/tasks/hooks');
        await onReminderNoResponse({ tenantId, reminderId });
        await publishReminderNoResponse(tenantId, reminderId);
        return { status: 'failed', reason: result.reason };
      }
      await markFallbackSent(reminderId, 'WHATSAPP', result.externalMessageId, null);
      return { status: 'fallback_sent' };
    }

    if (fbChannel === 'VOICE') {
      const result = await sendVoiceReminder({
        tenantId,
        reminderId,
        toPhoneE164: vars.contact.phone,
        vars,
        contactDisplayName: displayName,
        appointmentContactId: appt.contactId,
      });
      if (!result.ok) {
        await markFallbackFailed(reminderId, result.reason);
        const { onReminderNoResponse } = await import('@/lib/tasks/hooks');
        await onReminderNoResponse({ tenantId, reminderId });
        await publishReminderNoResponse(tenantId, reminderId);
        return { status: 'failed', reason: result.reason };
      }
      await markFallbackSent(reminderId, 'VOICE', null, result.callId);
      return { status: 'fallback_sent' };
    }

    return { status: 'skipped', reason: 'unknown_fallback' };
  });
}

/**
 * Mensajes: la cita sin confirmar se anuncia en #agenda con Llamar / Ver
 * recordatorios / Liberar el hueco. Best-effort: nunca rompe el job.
 */
async function publishReminderNoResponse(tenantId: string, reminderId: string): Promise<void> {
  try {
    const [rem] = await db
      .select({
        ghlAppointmentId: appointmentReminders.ghlAppointmentId,
        payloadSnapshot: appointmentReminders.payloadSnapshot,
      })
      .from(appointmentReminders)
      .where(
        and(
          eq(appointmentReminders.tenantId, tenantId),
          eq(appointmentReminders.id, reminderId),
        ),
      )
      .limit(1);
    if (!rem) return;

    const [appt] = await db
      .select({
        contactId: appointmentsCache.contactId,
        startTime: appointmentsCache.startTime,
      })
      .from(appointmentsCache)
      .where(
        and(
          eq(appointmentsCache.tenantId, tenantId),
          eq(appointmentsCache.ghlAppointmentId, rem.ghlAppointmentId),
        ),
      )
      .limit(1);

    const snapshot = (rem.payloadSnapshot ?? {}) as { vars?: ReminderVars };
    const { resolvePatient } = await import('@/lib/tasks/hooks');
    const patient = await resolvePatient(tenantId, {
      ghlContactId: appt?.contactId ?? null,
      phone: snapshot.vars?.contact?.phone ?? null,
    });

    const { postReminderNoResponse } = await import('@/lib/messaging/bot');
    await postReminderNoResponse({
      tenantId,
      reminderId,
      patientName: patient.name,
      phone: patient.phone,
      appointmentStart: appt?.startTime ?? null,
      ghlAppointmentId: rem.ghlAppointmentId,
    });
  } catch (err) {
    console.warn('[reminder-fallback-check] publish falló', (err as Error).message);
  }
}

async function markFallbackSent(
  reminderId: string,
  channel: 'WHATSAPP' | 'VOICE',
  externalMessageId: string | null,
  externalCallId: string | null,
): Promise<void> {
  await db
    .update(appointmentReminders)
    .set({
      channelUsed: channel,
      // Para no perder el tracking del primer send, dejamos status='SENT'.
      // El externalMessageId/externalCallId se sobreescribe con el fallback.
      externalMessageId: externalMessageId,
      externalCallId: externalCallId,
      updatedAt: new Date(),
    })
    .where(eq(appointmentReminders.id, reminderId));
}

async function markFallbackFailed(reminderId: string, reason: string): Promise<void> {
  await db
    .update(appointmentReminders)
    .set({ failureReason: `fallback_${reason}`, updatedAt: new Date() })
    .where(eq(appointmentReminders.id, reminderId));
}
