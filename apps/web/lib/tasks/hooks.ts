import 'server-only';
import { and, eq, gt } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentReminders,
  appointmentsCache,
  calls,
  patientsCache,
  phoneNumbers,
  treatments,
  whatsappContacts,
  whatsappConversations,
} from '@/lib/db/schema';
import { runTaskAutomation } from '@/lib/tasks/automation';
import { formatDateTime, fullName, getTenantTimezone } from '@/lib/tasks/materialize';

/**
 * Puntos de enganche entre el resto del producto y el módulo Tareas.
 *
 * Todos son best-effort y no lanzan: un webhook de GHL o un job de Retell no
 * puede fallar porque no se pudo crear una tarea. Se llaman con `void` o con
 * `.catch()` en el call site.
 */

interface PatientInfo {
  name: string;
  phone: string | null;
  ghlContactId: string | null;
}

/** Resuelve nombre y teléfono mirando la caché de pacientes y los contactos de WhatsApp. */
export async function resolvePatient(
  tenantId: string,
  args: { ghlContactId?: string | null; phone?: string | null },
): Promise<PatientInfo> {
  if (args.ghlContactId) {
    const [p] = await db
      .select({
        firstName: patientsCache.firstName,
        lastName: patientsCache.lastName,
        phone: patientsCache.phone,
      })
      .from(patientsCache)
      .where(
        and(
          eq(patientsCache.tenantId, tenantId),
          eq(patientsCache.ghlContactId, args.ghlContactId),
        ),
      )
      .limit(1);
    if (p) {
      return {
        name: fullName(p.firstName, p.lastName),
        phone: p.phone ?? args.phone ?? null,
        ghlContactId: args.ghlContactId,
      };
    }
  }

  if (args.phone) {
    const [c] = await db
      .select({
        name: whatsappContacts.name,
        firstName: whatsappContacts.firstName,
        lastName: whatsappContacts.lastName,
        phone: whatsappContacts.phoneE164,
      })
      .from(whatsappContacts)
      .where(
        and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.phoneE164, args.phone)),
      )
      .limit(1);
    const wappName =
      c?.name?.trim() || [c?.firstName, c?.lastName].filter(Boolean).join(' ').trim();
    if (wappName) {
      return {
        name: wappName,
        phone: c?.phone ?? args.phone,
        ghlContactId: args.ghlContactId ?? null,
      };
    }
    return {
      name: `Contacto ${args.phone}`,
      phone: args.phone,
      ghlContactId: args.ghlContactId ?? null,
    };
  }

  return { name: 'Paciente sin identificar', phone: null, ghlContactId: args.ghlContactId ?? null };
}

async function hasFutureAppointment(
  tenantId: string,
  ghlContactId: string | null,
): Promise<boolean> {
  if (!ghlContactId) return false;
  const rows = await db
    .select({ id: appointmentsCache.ghlAppointmentId })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        eq(appointmentsCache.contactId, ghlContactId),
        gt(appointmentsCache.startTime, new Date()),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Post-procesado de llamada.
 *
 * Dos lecturas distintas del mismo hecho:
 *   · la llamada se cortó sin que el agente resolviera nada → devolver llamada
 *   · el paciente quería cita y no quedó ninguna agendada → cerrar la agenda
 *
 * La segunda es la que más plata deja sobre la mesa: ya levantó el teléfono.
 */
export async function onCallProcessed(args: {
  tenantId: string;
  retellCallId: string;
}): Promise<void> {
  try {
    const [call] = await db
      .select()
      .from(calls)
      .where(and(eq(calls.tenantId, args.tenantId), eq(calls.retellCallId, args.retellCallId)))
      .limit(1);
    if (!call) return;

    const clinic = await clinicPhoneNumbers(args.tenantId);
    const leadPhone =
      [call.fromNumber, call.toNumber].find((p) => p && !clinic.has(p)) ?? call.fromNumber ?? null;

    const patient = await resolvePatient(args.tenantId, {
      ghlContactId: call.ghlContactId,
      phone: leadPhone,
    });
    const tz = await getTenantTimezone(args.tenantId);

    // ── Llamada cortada / sin resolver ────────────────────────────────────────
    const tooShort = (call.durationSeconds ?? 0) < 20;
    if (call.status === 'error' || tooShort) {
      await runTaskAutomation({
        tenantId: args.tenantId,
        trigger: 'MISSED_CALL',
        context: {
          patientName: patient.name,
          phone: patient.phone,
          date: call.startedAt ? formatDateTime(call.startedAt, tz) : null,
          patientGhlContactId: patient.ghlContactId,
          callId: call.id,
          dedupeSuffix: call.id,
        },
      });
      return;
    }

    // ── Quería cita y no quedó agendada ──────────────────────────────────────
    const wantedAppointment = ['agendar', 'reagendar'].includes((call.intent ?? '').toLowerCase());
    if (wantedAppointment && !(await hasFutureAppointment(args.tenantId, call.ghlContactId))) {
      await runTaskAutomation({
        tenantId: args.tenantId,
        trigger: 'CALL_INTENT_UNRESOLVED',
        context: {
          patientName: patient.name,
          phone: patient.phone,
          date: call.startedAt ? formatDateTime(call.startedAt, tz) : null,
          patientGhlContactId: patient.ghlContactId,
          callId: call.id,
          dedupeSuffix: call.id,
        },
      });
    }
  } catch (err) {
    console.warn('[tasks] onCallProcessed falló', (err as Error).message);
  }
}

/** Números propios de la clínica: el teléfono del paciente es "el otro". */
async function clinicPhoneNumbers(tenantId: string): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    const { getTenantTelephony } = await import('@/lib/data/tenant-telephony');
    const tele = await getTenantTelephony(tenantId).catch(() => null);
    if (tele?.inboundNumberE164) out.add(tele.inboundNumberE164);
  } catch {
    // Sin telefonía configurada seguimos: el fallback es fromNumber.
  }
  const nums = await db
    .select({ e164: phoneNumbers.e164 })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.tenantId, tenantId));
  for (const n of nums) if (n.e164) out.add(n.e164);
  return out;
}

/** Cita cancelada en GHL → reagendar en caliente. */
export async function onAppointmentCancelled(args: {
  tenantId: string;
  ghlAppointmentId: string;
  ghlContactId: string | null;
  startTime: Date | null;
}): Promise<void> {
  try {
    const tz = await getTenantTimezone(args.tenantId);
    const patient = await resolvePatient(args.tenantId, { ghlContactId: args.ghlContactId });
    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'APPOINTMENT_CANCELLED',
      context: {
        patientName: patient.name,
        phone: patient.phone,
        date: args.startTime ? formatDateTime(args.startTime, tz) : null,
        patientGhlContactId: patient.ghlContactId,
        ghlAppointmentId: args.ghlAppointmentId,
        dedupeSuffix: args.ghlAppointmentId,
      },
    });
  } catch (err) {
    console.warn('[tasks] onAppointmentCancelled falló', (err as Error).message);
  }
}

/** La cita quedó marcada como no-show. */
export async function onAppointmentNoShow(args: {
  tenantId: string;
  ghlAppointmentId: string;
  ghlContactId: string | null;
  startTime: Date | null;
}): Promise<void> {
  try {
    const tz = await getTenantTimezone(args.tenantId);
    const patient = await resolvePatient(args.tenantId, { ghlContactId: args.ghlContactId });
    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'APPOINTMENT_NO_SHOW',
      context: {
        patientName: patient.name,
        phone: patient.phone,
        date: args.startTime ? formatDateTime(args.startTime, tz) : null,
        patientGhlContactId: patient.ghlContactId,
        ghlAppointmentId: args.ghlAppointmentId,
        dedupeSuffix: args.ghlAppointmentId,
      },
    });
  } catch (err) {
    console.warn('[tasks] onAppointmentNoShow falló', (err as Error).message);
  }
}

/**
 * Cita completada → llamada postoperatoria.
 *
 * Solo para tratamientos que la clínica marcó como "requiere seguimiento"
 * (`treatments.post_op_follow_up`). Sin ese flag no se crea nada: llamar
 * después de una limpieza es ruido, llamar después de una extracción no.
 */
export async function onAppointmentCompleted(args: {
  tenantId: string;
  ghlAppointmentId: string;
  ghlContactId: string | null;
  startTime: Date | null;
  treatmentId: string | null;
}): Promise<void> {
  try {
    if (!args.treatmentId) return;
    const [tx] = await db
      .select({ name: treatments.name, followUp: treatments.postOpFollowUp })
      .from(treatments)
      .where(and(eq(treatments.tenantId, args.tenantId), eq(treatments.id, args.treatmentId)))
      .limit(1);
    if (!tx?.followUp) return;

    const tz = await getTenantTimezone(args.tenantId);
    const patient = await resolvePatient(args.tenantId, { ghlContactId: args.ghlContactId });
    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'POST_TREATMENT_FOLLOWUP',
      context: {
        patientName: patient.name,
        phone: patient.phone,
        treatment: tx.name,
        date: args.startTime ? formatDateTime(args.startTime, tz) : null,
        patientGhlContactId: patient.ghlContactId,
        ghlAppointmentId: args.ghlAppointmentId,
        dedupeSuffix: args.ghlAppointmentId,
      },
    });
  } catch (err) {
    console.warn('[tasks] onAppointmentCompleted falló', (err as Error).message);
  }
}

/** El recordatorio se envió y nadie respondió: toca llamar. */
export async function onReminderNoResponse(args: {
  tenantId: string;
  reminderId: string;
}): Promise<void> {
  try {
    const [rem] = await db
      .select({
        ghlAppointmentId: appointmentReminders.ghlAppointmentId,
        payloadSnapshot: appointmentReminders.payloadSnapshot,
      })
      .from(appointmentReminders)
      .where(
        and(
          eq(appointmentReminders.tenantId, args.tenantId),
          eq(appointmentReminders.id, args.reminderId),
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
          eq(appointmentsCache.tenantId, args.tenantId),
          eq(appointmentsCache.ghlAppointmentId, rem.ghlAppointmentId),
        ),
      )
      .limit(1);

    const snapshot = (rem.payloadSnapshot ?? {}) as {
      vars?: { contact?: { phone?: string | null } };
    };
    const tz = await getTenantTimezone(args.tenantId);
    const patient = await resolvePatient(args.tenantId, {
      ghlContactId: appt?.contactId ?? null,
      phone: snapshot.vars?.contact?.phone ?? null,
    });

    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'REMINDER_NO_RESPONSE',
      context: {
        patientName: patient.name,
        phone: patient.phone,
        date: appt?.startTime ? formatDateTime(appt.startTime, tz) : null,
        patientGhlContactId: patient.ghlContactId,
        ghlAppointmentId: rem.ghlAppointmentId,
        reminderId: args.reminderId,
        dedupeSuffix: args.reminderId,
      },
    });
  } catch (err) {
    console.warn('[tasks] onReminderNoResponse falló', (err as Error).message);
  }
}

/** Aceptó un hueco de la waitlist y la cita no llegó a crearse. */
export async function onWaitlistAcceptedUnscheduled(args: {
  tenantId: string;
  entryId: string;
  ghlContactId: string | null;
  slotStart: Date | null;
}): Promise<void> {
  try {
    const tz = await getTenantTimezone(args.tenantId);
    const patient = await resolvePatient(args.tenantId, { ghlContactId: args.ghlContactId });
    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'WAITLIST_ACCEPTED_UNSCHEDULED',
      context: {
        patientName: patient.name,
        phone: patient.phone,
        date: args.slotStart ? formatDateTime(args.slotStart, tz) : null,
        patientGhlContactId: patient.ghlContactId,
        waitlistEntryId: args.entryId,
        dedupeSuffix: args.entryId,
      },
    });
  } catch (err) {
    console.warn('[tasks] onWaitlistAcceptedUnscheduled falló', (err as Error).message);
  }
}

/** Conversación de WhatsApp que pasa a manos humanas. */
export async function onWhatsappHandoff(args: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  try {
    const [conv] = await db
      .select({
        id: whatsappConversations.id,
        phone: whatsappContacts.phoneE164,
        displayName: whatsappContacts.name,
        ghlContactId: whatsappContacts.ghlContactId,
        updatedAt: whatsappConversations.updatedAt,
      })
      .from(whatsappConversations)
      .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
      .where(
        and(
          eq(whatsappConversations.tenantId, args.tenantId),
          eq(whatsappConversations.id, args.conversationId),
        ),
      )
      .limit(1);
    if (!conv) return;

    // Una tarea por conversación y por día: si el chat sigue caliente mañana,
    // vuelve a aparecer; no una tarea por cada mensaje.
    const dayKey = new Date().toISOString().slice(0, 10);
    await runTaskAutomation({
      tenantId: args.tenantId,
      trigger: 'WHATSAPP_HANDOFF',
      context: {
        patientName: conv.displayName ?? `Contacto ${conv.phone}`,
        phone: conv.phone,
        patientGhlContactId: conv.ghlContactId ?? null,
        whatsappConversationId: conv.id,
        dedupeSuffix: `${conv.id}:${dayKey}`,
      },
    });
  } catch (err) {
    console.warn('[tasks] onWhatsappHandoff falló', (err as Error).message);
  }
}
