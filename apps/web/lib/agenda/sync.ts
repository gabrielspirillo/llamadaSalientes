import 'server-only';
import { and, eq } from 'drizzle-orm';

import { calendarRefForProfessional } from '@/lib/agenda/appointment-ref';
import { recordCancelledSlot, tryAttributeNewAppointment } from '@/lib/analytics/slot-attribution';
import { deleteAppointmentCache, upsertInternalAppointmentCache } from '@/lib/appointments/cache';
import { db } from '@/lib/db/client';
import { type agendaAppointments, treatments } from '@/lib/db/schema';

/**
 * Lo que dispara una cita de la agenda de la plataforma.
 *
 * Hasta aquí la agenda era una isla. La cita se guardaba en
 * `agenda_appointments` y ahí se acababa todo: los recordatorios, la lista de
 * espera, las tareas automáticas, los avisos del chat interno y las métricas
 * colgaban de un único disparador, el webhook de citas de GoHighLevel. Una
 * clínica sin CRM tenía agenda y nada más; y una clínica CON CRM que agendara
 * desde el panel tampoco tenía nada, porque esa cita nunca pasaba por GHL.
 *
 * Este módulo es, para las citas propias, el equivalente de aquel webhook:
 * mismos efectos, mismas funciones, en el mismo orden.
 *
 * Reglas de la casa:
 *   - Nunca lanza. Una cita confirmada no se cae porque no se pudiera
 *     programar su recordatorio; el fallo se registra y la cita se queda.
 *   - Idempotente: cada efecto ya lo era (clave de deduplicación en tareas y
 *     mensajes, `on conflict do nothing` en huecos cancelados), así que
 *     reprocesar una cita no duplica nada.
 *   - Se dispara por TRANSICIÓN, no por estado: sólo hace algo cuando la cita
 *     acaba de pasar a cancelada, a no asistió o a completada. Guardar una nota
 *     en una cita ya cancelada no vuelve a anunciarla en el chat.
 */

export type AgendaAppointmentRow = typeof agendaAppointments.$inferSelect;
type AgendaStatus = AgendaAppointmentRow['status'];

/** Estados en los que la cita sigue en pie. */
const ACTIVE: ReadonlySet<AgendaStatus> = new Set<AgendaStatus>([
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_PROGRESS',
]);

/**
 * El estado, en el vocabulario que ya entienden la caché y las métricas.
 *
 * Las métricas del panel cuentan `completed` y `no_show`; los ayudantes del
 * webhook aceptan además las variantes de GoHighLevel (`showed`, `noshow`).
 * Se escriben las dos primeras porque son las únicas que satisfacen a los dos
 * lectores, y así toda la maquinaria que ya existía cuenta las citas propias
 * sin cambiar una línea.
 */
export function cacheStatusFor(status: AgendaStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'NO_SHOW':
      return 'no_show';
    default:
      return 'confirmed';
  }
}

/**
 * Con qué identidad se guarda al paciente en las tablas compartidas.
 *
 * Con CRM, su id (así una cita propia y una de GHL del mismo paciente quedan
 * bajo la misma clave). Sin CRM, la `patient_key` de la agenda, que es estable
 * dentro de la clínica.
 */
export function contactRefFor(appointment: AgendaAppointmentRow): string {
  return appointment.ghlContactId?.trim() || appointment.patientKey;
}

export interface SyncAppointmentInput {
  appointment: AgendaAppointmentRow;
  /** Estado antes del cambio. `null` cuando la cita se acaba de crear. */
  previousStatus?: AgendaStatus | null;
  change: 'created' | 'rescheduled' | 'updated';
}

export async function syncAppointmentEffects(input: SyncAppointmentInput): Promise<void> {
  try {
    await runSync(input);
  } catch (err) {
    console.error('[agenda-sync] falló la propagación de la cita', {
      appointmentId: input.appointment.id,
      change: input.change,
      err: (err as Error).message,
    });
  }
}

async function runSync({
  appointment,
  previousStatus = null,
  change,
}: SyncAppointmentInput): Promise<void> {
  const tenantId = appointment.tenantId;
  const status = appointment.status;
  const isNew = change === 'created';
  const contactRef = contactRefFor(appointment);
  const calendarRef = calendarRefForProfessional(appointment.professionalId);

  // ── 1. Espejo en la caché de citas ──────────────────────────────────────────
  // Cancelar borra la fila, igual que hace el webhook de GHL: el rastro de la
  // cancelación vive en `cancelled_slots`, que es de donde salen las métricas.
  if (status === 'CANCELLED') {
    await deleteAppointmentCache({ tenantId, ghlAppointmentId: appointment.id }).catch((err) =>
      console.warn('[agenda-sync] borrar de la caché', err),
    );
  } else {
    const title = await treatmentName(tenantId, appointment.treatmentId);
    await upsertInternalAppointmentCache({
      tenantId,
      appointmentId: appointment.id,
      contactRef,
      calendarRef,
      treatmentId: appointment.treatmentId,
      professionalId: appointment.professionalId,
      title,
      startTime: appointment.startsAt,
      endTime: appointment.endsAt,
      status: cacheStatusFor(status),
    }).catch((err) => console.warn('[agenda-sync] espejo en la caché', err));
  }

  // ── 2. Recordatorios ────────────────────────────────────────────────────────
  //
  // Se (re)programan al crear la cita, al moverla y al revivir una que estaba
  // cancelada. NO en cualquier edición: `materializeReminders` con motivo
  // `update` empieza cancelando los que ya había, así que corregirle el nombre
  // al paciente tiraría los recordatorios vivos y volvería a calcularlos, con
  // el riesgo de que alguno caiga ahora en horario de silencio y se pierda.
  const revivida = !isNew && previousStatus !== null && !ACTIVE.has(previousStatus);
  if (ACTIVE.has(status)) {
    if (isNew || change === 'rescheduled' || revivida) {
      const { materializeReminders } = await import('@/lib/reminders/materialize');
      await materializeReminders({
        tenantId,
        ghlAppointmentId: appointment.id,
        reason: isNew ? 'create' : 'update',
      }).catch((err) => console.warn('[agenda-sync] recordatorios', err));
    }
  } else if (!isNew || status === 'CANCELLED') {
    const { cancelReminders } = await import('@/lib/reminders/cancel');
    await cancelReminders({
      tenantId,
      ghlAppointmentId: appointment.id,
      reason: status === 'CANCELLED' ? 'appointment_cancelled' : 'appointment_no_show',
    }).catch((err) => console.warn('[agenda-sync] cancelar recordatorios', err));
  }

  // ── 3. Transiciones de estado ───────────────────────────────────────────────
  const entered = (target: AgendaStatus) => status === target && previousStatus !== target;

  if (entered('CANCELLED')) {
    await onCancelled(appointment, contactRef, calendarRef);
  } else if (entered('NO_SHOW')) {
    await onNoShow(appointment, contactRef);
  } else if (entered('COMPLETED')) {
    const { onAppointmentCompleted } = await import('@/lib/tasks/hooks');
    await onAppointmentCompleted({
      tenantId,
      ghlAppointmentId: appointment.id,
      ghlContactId: contactRef,
      startTime: appointment.startsAt,
      treatmentId: appointment.treatmentId,
    });
  }

  // ── 4. Cita nueva: atribución de hueco recuperado y lista de espera ─────────
  if (isNew && ACTIVE.has(status)) {
    await onCreated(appointment, contactRef, calendarRef);
  }
}

async function onCancelled(
  appointment: AgendaAppointmentRow,
  contactRef: string,
  calendarRef: string,
): Promise<void> {
  const tenantId = appointment.tenantId;

  const { onAppointmentCancelled } = await import('@/lib/tasks/hooks');
  await onAppointmentCancelled({
    tenantId,
    ghlAppointmentId: appointment.id,
    ghlContactId: contactRef,
    startTime: appointment.startsAt,
  });

  await publishAppointmentEvent('cancelled', appointment, contactRef);

  // El hueco que se libera: es lo que alimenta la métrica de recuperación y lo
  // que le ofrece la plaza al siguiente de la lista de espera.
  const cancelled = await recordCancelledSlot({
    tenantId,
    ghlAppointmentId: appointment.id,
    calendarId: calendarRef,
    treatmentId: appointment.treatmentId,
    ghlContactId: contactRef,
    startTime: appointment.startsAt,
    endTime: appointment.endsAt,
  }).catch((err) => {
    console.warn('[agenda-sync] registrar hueco cancelado', err);
    return null;
  });

  if (cancelled) {
    const { enqueueOfferForCancelledSlot } = await import('@/lib/waitlist/engine');
    await enqueueOfferForCancelledSlot(tenantId, cancelled.id).catch((err) =>
      console.warn('[agenda-sync] oferta de lista de espera', err),
    );
  }
}

async function onNoShow(appointment: AgendaAppointmentRow, contactRef: string): Promise<void> {
  const { onAppointmentNoShow } = await import('@/lib/tasks/hooks');
  await onAppointmentNoShow({
    tenantId: appointment.tenantId,
    ghlAppointmentId: appointment.id,
    ghlContactId: contactRef,
    startTime: appointment.startsAt,
  });
  await publishAppointmentEvent('no_show', appointment, contactRef);
}

async function onCreated(
  appointment: AgendaAppointmentRow,
  contactRef: string,
  calendarRef: string,
): Promise<void> {
  const tenantId = appointment.tenantId;

  await tryAttributeNewAppointment({
    tenantId,
    ghlAppointmentId: appointment.id,
    calendarId: calendarRef,
    treatmentId: appointment.treatmentId,
    ghlContactId: contactRef,
    startTime: appointment.startsAt,
    endTime: appointment.endsAt,
    createdAt: appointment.createdAt ?? new Date(),
  }).catch((err) => console.warn('[agenda-sync] atribución del hueco', err));

  const { autoEnqueueOnNewAppointment } = await import('@/lib/waitlist/engine');
  await autoEnqueueOnNewAppointment({
    tenantId,
    ghlContactId: contactRef,
    ghlAppointmentId: appointment.id,
    treatmentId: appointment.treatmentId,
    calendarId: calendarRef,
    assignedUserId: appointment.professionalId,
    startTime: appointment.startsAt,
    endTime: appointment.endsAt,
  }).catch((err) => console.warn('[agenda-sync] alta en lista de espera', err));
}

/**
 * La tarjeta de la cita en el chat interno del equipo.
 *
 * El nombre y el teléfono salen de la propia cita: la agenda los guarda
 * desnormalizados justamente para no depender de ninguna ficha externa.
 */
async function publishAppointmentEvent(
  kind: 'cancelled' | 'no_show',
  appointment: AgendaAppointmentRow,
  contactRef: string,
): Promise<void> {
  try {
    const { postAppointmentCancelled, postAppointmentNoShow } = await import('@/lib/messaging/bot');
    const post = kind === 'cancelled' ? postAppointmentCancelled : postAppointmentNoShow;
    await post({
      tenantId: appointment.tenantId,
      ghlAppointmentId: appointment.id,
      patientName: appointment.patientName,
      phone: appointment.patientPhone,
      startTime: appointment.startsAt,
    });
  } catch (err) {
    console.warn('[agenda-sync] publicar el aviso de la cita', (err as Error).message, {
      contactRef,
    });
  }
}

async function treatmentName(tenantId: string, treatmentId: string | null): Promise<string | null> {
  if (!treatmentId) return null;
  const rows = await db
    .select({ name: treatments.name })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, treatmentId)))
    .limit(1);
  return rows[0]?.name ?? null;
}
