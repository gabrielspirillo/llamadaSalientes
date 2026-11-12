import 'server-only';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import { systemAgendaContext } from '@/lib/agenda/agent';
import { normalizePatientPhone, samePhone } from '@/lib/agenda/patients';
import { updateAppointment } from '@/lib/agenda/service';
import { sendClinicWhatsapp } from '@/lib/care-profile/clinic-whatsapp';
import {
  type DayOfAction,
  type DayOfStep,
  clockMinutes,
  nextDayOfStep,
  parseDayOfTextReply,
  whenToday,
} from '@/lib/care-profile/day-of';
import {
  type CareMessageScripts,
  fillScript,
  parseMessageScripts,
} from '@/lib/care-profile/messages';
import { parseGuardians, primaryGuardian } from '@/lib/care-profile/policy';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  appointmentDayOf,
  clinicSettings,
  patients,
  tenantCareProfile,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { getPatientPerson } from '@/lib/patients/persons';
import { sendQueueEvent } from '@/lib/queue/client';
import { formatDateTime } from '@/lib/tasks/materialize';
import { localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { relativeDayLabel } from '@/lib/whatsapp/agent/slot-mention';

type DayOfScripts = NonNullable<CareMessageScripts['dayOf']>;
type Appointment = typeof agendaAppointments.$inferSelect;

export const DAY_OF_BUTTON_RE = /^dayof:(confirm|modify|cancel):([0-9a-f-]{36})$/i;

function dayOfButtons(appointmentId: string) {
  return [
    { id: `dayof:confirm:${appointmentId}`, title: 'Confirmar' },
    { id: `dayof:modify:${appointmentId}`, title: 'Modificar' },
    { id: `dayof:cancel:${appointmentId}`, title: 'Cancelar' },
  ];
}

async function firstNameOf(appt: Appointment): Promise<string | null> {
  if (appt.patientId) {
    const person = await getPatientPerson(appt.tenantId, appt.patientId).catch(() => null);
    if (person) return person.firstName;
  }
  return appt.patientName.trim().split(/\s+/)[0] || null;
}

function vars(appt: Appointment, timezone: string, paciente: string | null) {
  const p = localParts(appt.startsAt, timezone);
  const hora = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return { paciente, hora, cuando: whenToday(p.hour * 60 + p.minute) };
}

// ─── Tick del worker ─────────────────────────────────────────────────────────

/**
 * Recorre las citas de HOY sin confirmar de cada clínica con la secuencia
 * activada y ejecuta, como mucho, un paso por cita. Cada paso se "reclama"
 * en la base antes de mandar nada, así que dos ticks a la vez no duplican.
 */
export async function runDayOfTick(now = new Date()): Promise<{ steps: number }> {
  let steps = 0;
  // Ofertas de adelanto vencidas (todas las clínicas, tengan o no guiones).
  const { expireAdvanceOffers, flushNightOfferQueue } = await import('@/lib/agenda/advance-offers');
  steps += await expireAdvanceOffers(now).catch((err) => {
    console.warn('[adelanto] caducar ofertas', (err as Error).message);
    return 0;
  });
  steps += await flushNightOfferQueue(now).catch((err) => {
    console.warn('[adelanto] cola de noche', (err as Error).message);
    return 0;
  });
  const profiles = await db
    .select({ tenantId: tenantCareProfile.tenantId, scripts: tenantCareProfile.messageScripts })
    .from(tenantCareProfile)
    .where(sql`${tenantCareProfile.messageScripts} ? 'dayOf'`);

  const { isTenantArchived } = await import('@/lib/tenants/archive');
  for (const profile of profiles) {
    const dayOf = parseMessageScripts(profile.scripts)?.dayOf;
    if (!dayOf) continue;
    if (await isTenantArchived(profile.tenantId)) continue;
    try {
      steps += await tickTenant(profile.tenantId, dayOf, now);
    } catch (err) {
      console.warn('[day-of] tick', profile.tenantId, (err as Error).message);
    }
  }
  return { steps };
}

async function tickTenant(tenantId: string, dayOf: DayOfScripts, now: Date): Promise<number> {
  const [settings] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  const tz = settings?.timezone || 'Europe/Madrid';
  const today = parseDateKey(localDateKey(now, tz));
  if (!today) return 0;
  const dayStart = zonedToUtc(today.year, today.month, today.day, 0, 0, tz);
  const dayEnd = new Date(dayStart.getTime() + 36 * 3_600_000);
  const nowParts = localParts(now, tz);
  const nowMinute = nowParts.hour * 60 + nowParts.minute;
  const reminderAt = clockMinutes(dayOf.reminderAt);
  if (reminderAt === null || nowMinute < reminderAt) return 0;

  // Citas de hoy, sin confirmar, reservadas ANTES de hoy (quien reserva hoy
  // para hoy acaba de hablar con la clínica) y con teléfono.
  const rows = await db
    .select({ appt: agendaAppointments, state: appointmentDayOf })
    .from(agendaAppointments)
    .leftJoin(appointmentDayOf, eq(appointmentDayOf.appointmentId, agendaAppointments.id))
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
        gte(agendaAppointments.startsAt, now),
        lt(agendaAppointments.startsAt, dayEnd),
        lt(agendaAppointments.createdAt, dayStart),
        sql`${agendaAppointments.patientPhone} is not null`,
      ),
    );

  let done = 0;
  for (const row of rows) {
    const { appt } = row;
    if (localDateKey(appt.startsAt, tz) !== localDateKey(now, tz)) continue;
    // La confirmación que vale es la del MISMO DÍA. Un estado que no se tocó
    // hoy es de antes: una confirmación anticipada ("1" días antes), un
    // recordatorio mandado a mano el viernes o la respuesta del día que tenía
    // la cita antes de moverla. Hasta el 10/11 cualquiera de esos tapaba el
    // recordatorio obligatorio y la cita se quedaba sin confirmar.
    let state = row.state;
    let status = appt.status;
    // Confirmada ANTES de hoy sin estado del día (por el panel días atrás):
    // tampoco vale, igual que una respuesta de otro día.
    const confirmedBeforeToday = status === 'CONFIRMED' && appt.updatedAt < dayStart;
    if ((state && state.updatedAt < dayStart) || (!state && confirmedBeforeToday)) {
      // Pasada la hora de anular ya no empieza la secuencia (ver
      // `nextDayOfStep`): entonces tampoco se toca lo que había.
      const p0 = localParts(appt.startsAt, tz);
      const cancelAt = clockMinutes(dayOf.cancelAt);
      const tooLate =
        cancelAt !== null && cancelAt < p0.hour * 60 + p0.minute && nowMinute >= cancelAt;
      if (tooLate) continue;
      await resetDayOfState(appt);
      state = null;
      status = 'SCHEDULED';
    }
    if (state?.outcome && state.outcome !== 'NEEDS_CALL') continue;
    // Confirmada HOY (botón, "1", panel, llamada, en persona): ya está, con o
    // sin recordatorio mandado. El 12/11 tres citas que Raquel confirmó a mano
    // después del recordatorio de las 08:00 se anularon a las 12:30: esta
    // excepción sólo miraba las citas que aún no tenían recordatorio.
    if (status === 'CONFIRMED') {
      if (!state?.outcome) await markOutcome(appt, 'CONFIRMED');
      continue;
    }
    if (state?.outcome) continue;
    const p = localParts(appt.startsAt, tz);
    // Un recordatorio mandado a mano otro día ("Enviar ahora" la víspera) no
    // cuenta: el de las 08:00 sale igual.
    const sentToday =
      state?.reminderSentAt && state.reminderSentAt >= dayStart ? state.reminderSentAt : null;
    const step = nextDayOfStep({
      times: dayOf,
      state: {
        reminderSentAt: sentToday,
        nudgeSentAt: state?.nudgeSentAt && state.nudgeSentAt >= dayStart ? state.nudgeSentAt : null,
        callsDone: state?.callsDone ?? 0,
      },
      now,
      nowMinute,
      startMinute: p.hour * 60 + p.minute,
    });
    if (!step) continue;
    try {
      if (await runStep(appt, step, dayOf, tz)) done++;
    } catch (err) {
      console.warn('[day-of] paso', { appointmentId: appt.id, step, err: (err as Error).message });
    }
  }
  return done;
}

/**
 * Deja la cita sin respuesta del día: borra lo de un día anterior y, si se
 * había confirmado antes del día, la devuelve a "Agendada" para que el
 * calendario no la pinte confirmada mientras no conteste el recordatorio.
 */
async function resetDayOfState(appt: Appointment): Promise<void> {
  const at = new Date();
  await db
    .update(appointmentDayOf)
    .set({
      reminderSentAt: null,
      nudgeSentAt: null,
      callsDone: 0,
      outcome: null,
      outcomeAt: null,
      updatedAt: at,
    })
    .where(
      and(
        eq(appointmentDayOf.appointmentId, appt.id),
        eq(appointmentDayOf.tenantId, appt.tenantId),
      ),
    );
  if (appt.status === 'CONFIRMED') {
    await db
      .update(agendaAppointments)
      .set({ status: 'SCHEDULED', updatedAt: at })
      .where(
        and(eq(agendaAppointments.tenantId, appt.tenantId), eq(agendaAppointments.id, appt.id)),
      );
  }
}

/**
 * A quién va el recordatorio del día: SÓLO al teléfono que dio la cita.
 * Del 10 al 11/11 se mandó también a los demás tutores de la ficha y la
 * clínica lo pidió fuera («que sólo le llegue al que agendó, como antes»).
 * Sin teléfono en la cita (una cita del panel sin móvil), el titular de la
 * ficha.
 */
export async function dayOfRecipients(appt: Appointment): Promise<string[]> {
  const valid = (raw: string | null | undefined) => {
    const p = raw ? normalizePatientPhone(raw) : null;
    return p && /^\+\d{8,15}$/.test(p) ? p : null;
  };
  const own = valid(appt.patientPhone);
  if (own) return [own];
  if (!appt.patientId) return [];
  const [person] = await db
    .select({ guardians: patients.guardians })
    .from(patients)
    .where(and(eq(patients.tenantId, appt.tenantId), eq(patients.id, appt.patientId)))
    .limit(1);
  const holder = valid(primaryGuardian(parseGuardians(person?.guardians))?.phone);
  return holder ? [holder] : [];
}

/** Hoy es un solo destinatario; el bucle queda por si vuelve a haber más. */
async function sendToRecipients(
  appt: Appointment,
  texts: string[],
  buttons?: Parameters<typeof sendClinicWhatsapp>[3],
): Promise<boolean> {
  const [first, ...rest] = await dayOfRecipients(appt);
  if (!first) return false;
  const sent = await sendClinicWhatsapp(appt.tenantId, first, texts, buttons);
  for (const phone of rest) {
    await sendClinicWhatsapp(appt.tenantId, phone, texts, buttons).catch((err) =>
      console.warn('[day-of] otro tutor', (err as Error).message),
    );
  }
  return sent;
}

async function runStep(
  appt: Appointment,
  step: DayOfStep,
  dayOf: DayOfScripts,
  tz: string,
): Promise<boolean> {
  const phone = appt.patientPhone as string;
  const at = new Date();
  await db
    .insert(appointmentDayOf)
    .values({ appointmentId: appt.id, tenantId: appt.tenantId })
    .onConflictDoNothing();
  const scope = and(
    eq(appointmentDayOf.appointmentId, appt.id),
    eq(appointmentDayOf.tenantId, appt.tenantId),
    isNull(appointmentDayOf.outcome),
  );
  const v = vars(appt, tz, await firstNameOf(appt));

  if (step.kind === 'reminder') {
    const claimed = await db
      .update(appointmentDayOf)
      .set({ reminderSentAt: at, updatedAt: at })
      .where(and(scope, isNull(appointmentDayOf.reminderSentAt)))
      .returning({ id: appointmentDayOf.appointmentId });
    if (!claimed.length) return false;
    try {
      const sent = await sendToRecipients(
        appt,
        [fillScript(dayOf.reminder, v)],
        dayOfButtons(appt.id),
      );
      if (!sent) throw new Error('sin conector de WhatsApp');
    } catch (err) {
      // Sin recordatorio no hay anulación: se suelta para reintentar.
      await db
        .update(appointmentDayOf)
        .set({ reminderSentAt: null, updatedAt: new Date() })
        .where(eq(appointmentDayOf.appointmentId, appt.id));
      throw err;
    }
    return true;
  }

  if (step.kind === 'nudge') {
    const claimed = await db
      .update(appointmentDayOf)
      .set({ nudgeSentAt: at, updatedAt: at })
      .where(and(scope, isNull(appointmentDayOf.nudgeSentAt)))
      .returning({ id: appointmentDayOf.appointmentId });
    if (!claimed.length) return false;
    if (dayOf.nudge) await sendToRecipients(appt, [fillScript(dayOf.nudge, v)]);
    return true;
  }

  if (step.kind === 'call') {
    const claimed = await db
      .update(appointmentDayOf)
      .set({ callsDone: step.index + 1, updatedAt: at })
      .where(and(scope, eq(appointmentDayOf.callsDone, step.index)))
      .returning({ id: appointmentDayOf.appointmentId });
    if (!claimed.length) return false;
    if (dayOf.callVia === 'whatsapp' && dayOf.nudge) {
      await sendToRecipients(appt, [fillScript(dayOf.nudge, v)]);
    } else {
      await askTeamToCall(appt, tz, step.index);
    }
    return true;
  }

  // cancel. Anular es lo único irreversible de la secuencia: antes se
  // comprueba que la falta de respuesta signifique de verdad que no
  // contestaron. Si no se puede asegurar, NO se anula: se pide al equipo que
  // llame (12/11: siete citas anuladas porque los "1" no llegaron).
  const doubt = await cancelDoubt(appt, dayOf, tz);
  if (doubt) {
    const parked = await db
      .update(appointmentDayOf)
      .set({ outcome: 'NEEDS_CALL', outcomeAt: at, updatedAt: at })
      .where(scope)
      .returning({ id: appointmentDayOf.appointmentId });
    if (!parked.length) return false;
    console.warn('[day-of] no se anula por falta de confirmación', {
      appointmentId: appt.id,
      doubt,
    });
    await askTeamToConfirm(appt, tz, doubt);
    return true;
  }
  const claimed = await db
    .update(appointmentDayOf)
    .set({ outcome: 'AUTO_CANCELLED', outcomeAt: at, updatedAt: at })
    .where(scope)
    .returning({ id: appointmentDayOf.appointmentId });
  if (!claimed.length) return false;
  await updateAppointment(systemAgendaContext(appt.tenantId), appt.id, {
    status: 'CANCELLED',
    cancelledBy: 'PATIENT',
    cancelReason: `Sin confirmar a las ${dayOf.cancelAt ?? 'hora límite'}`,
  });
  if (dayOf.autoCancelled) {
    await sendClinicWhatsapp(appt.tenantId, phone, [fillScript(dayOf.autoCancelled, v)]);
  }
  return true;
}

/** Antelación mínima entre el recordatorio y la anulación automática. */
const MIN_REMINDER_TO_CANCEL_MS = 90 * 60_000;

/**
 * Motivo para NO anular, o null si la anulación es segura:
 * - la cita ya no está "Agendada" (la confirmaron, la movieron, llegó);
 * - el recordatorio no salió o salió tarde (sin margen para contestar);
 * - el WhatsApp no da prueba de que recibe desde que salió el recordatorio
 *   (desconectado, o entrando mensajes con retraso).
 */
async function cancelDoubt(
  appt: Appointment,
  dayOf: DayOfScripts,
  tz: string,
): Promise<'STATUS' | 'NO_REMINDER' | 'LATE_REMINDER' | 'CHANNEL' | null> {
  const [fresh] = await db
    .select({ status: agendaAppointments.status })
    .from(agendaAppointments)
    .where(and(eq(agendaAppointments.tenantId, appt.tenantId), eq(agendaAppointments.id, appt.id)))
    .limit(1);
  if (!fresh || fresh.status !== 'SCHEDULED') return 'STATUS';
  const [state] = await db
    .select({ reminderSentAt: appointmentDayOf.reminderSentAt })
    .from(appointmentDayOf)
    .where(
      and(
        eq(appointmentDayOf.appointmentId, appt.id),
        eq(appointmentDayOf.tenantId, appt.tenantId),
      ),
    )
    .limit(1);
  const sentAt = state?.reminderSentAt ?? null;
  if (!sentAt) return 'NO_REMINDER';
  const cancelMinute = clockMinutes(dayOf.cancelAt);
  if (cancelMinute !== null) {
    const today = parseDateKey(localDateKey(new Date(), tz));
    if (today) {
      const cancelAt = zonedToUtc(
        today.year,
        today.month,
        today.day,
        Math.floor(cancelMinute / 60),
        cancelMinute % 60,
        tz,
      );
      if (cancelAt.getTime() - sentAt.getTime() < MIN_REMINDER_TO_CANCEL_MS) {
        return 'LATE_REMINDER';
      }
    }
  }
  const { isReceivingSince } = await import('@/lib/whatsapp/health');
  if (!(await isReceivingSince(appt.tenantId, sentAt))) return 'CHANNEL';
  return null;
}

/** La cita no se anuló por una duda: tarea de llamar + tarjeta que explica por qué. */
async function askTeamToConfirm(
  appt: Appointment,
  tz: string,
  doubt: 'STATUS' | 'NO_REMINDER' | 'LATE_REMINDER' | 'CHANNEL',
): Promise<void> {
  if (doubt === 'STATUS') return;
  const { runTaskAutomation } = await import('@/lib/tasks/automation');
  await runTaskAutomation({
    tenantId: appt.tenantId,
    trigger: 'REMINDER_NO_RESPONSE',
    context: {
      patientName: appt.patientName,
      phone: appt.patientPhone,
      date: formatDateTime(appt.startsAt, tz),
      ghlAppointmentId: appt.id,
      dedupeSuffix: `dayof:${appt.id}:needs-call`,
    },
  }).catch((err) => console.warn('[day-of] tarea de confirmar', err));
  const why =
    doubt === 'CHANNEL'
      ? 'El WhatsApp no está recibiendo bien los mensajes, así que puede que la familia sí contestara. NO se ha anulado: confirmad por teléfono.'
      : 'El recordatorio no salió a tiempo, así que no se ha anulado: confirmad por teléfono.';
  const { postSystemEvent } = await import('@/lib/messaging/bot');
  await postSystemEvent({
    tenantId: appt.tenantId,
    event: 'reminder.no_response',
    title: `Sin confirmar, NO anulada — ${appt.patientName}`,
    body: `Cita: ${formatDateTime(appt.startsAt, tz)}\n${why}`,
    context: { type: 'APPOINTMENT', id: appt.id, payload: { patientName: appt.patientName } },
    actions: appt.patientPhone
      ? [
          {
            id: 'call',
            label: `Llamar a ${appt.patientName}`,
            tone: 'primary',
            href: `tel:${appt.patientPhone}`,
          },
        ]
      : [],
    dedupeKey: `evt:dayof.needs_call:${appt.id}`,
  }).catch((err) => console.warn('[day-of] aviso de no anulada', err));
}

/** Tarea "llamar" + tarjeta en #agenda con botón de llamar. Best-effort. */
async function askTeamToCall(appt: Appointment, tz: string, index: number): Promise<void> {
  const { runTaskAutomation } = await import('@/lib/tasks/automation');
  await runTaskAutomation({
    tenantId: appt.tenantId,
    trigger: 'REMINDER_NO_RESPONSE',
    context: {
      patientName: appt.patientName,
      phone: appt.patientPhone,
      date: formatDateTime(appt.startsAt, tz),
      ghlAppointmentId: appt.id,
      dedupeSuffix: `dayof:${appt.id}:${index}`,
    },
  }).catch((err) => console.warn('[day-of] tarea de llamar', err));
  const { postReminderNoResponse } = await import('@/lib/messaging/bot');
  await postReminderNoResponse({
    tenantId: appt.tenantId,
    reminderId: `dayof-${appt.id}-${index}`,
    patientName: appt.patientName,
    phone: appt.patientPhone,
    appointmentStart: appt.startsAt,
    ghlAppointmentId: appt.id,
  }).catch((err) => console.warn('[day-of] aviso en #agenda', err));
}

// ─── Respuestas del paciente ─────────────────────────────────────────────────

async function loadForPatient(
  tenantId: string,
  appointmentId: string,
  phone: string | null,
): Promise<Appointment | null> {
  const [appt] = await db
    .select()
    .from(agendaAppointments)
    .where(and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.id, appointmentId)))
    .limit(1);
  if (!appt) return null;
  // Sólo quien recibe los avisos de esa cita (su teléfono o el de otro tutor
  // del niño) puede contestar por ella.
  if (phone && appt.patientPhone && !samePhone(phone, appt.patientPhone)) {
    const recipients = await dayOfRecipients(appt);
    if (!recipients.some((r) => samePhone(r, phone))) return null;
  }
  return appt;
}

async function markOutcome(appt: Appointment, outcome: string): Promise<void> {
  const at = new Date();
  await db
    .insert(appointmentDayOf)
    .values({ appointmentId: appt.id, tenantId: appt.tenantId, outcome, outcomeAt: at })
    .onConflictDoUpdate({
      target: appointmentDayOf.appointmentId,
      set: { outcome, outcomeAt: at, updatedAt: at },
    });
}

/**
 * Confirmar o cancelar una cita en nombre del paciente (botón del recordatorio
 * o el asistente). Devuelve los mensajes de la clínica para contestarle; []
 * si la clínica no tiene guiones. `null` si la cita no es suya o ya no está
 * pendiente.
 */
export async function answerDayOf(args: {
  tenantId: string;
  appointmentId: string;
  phone: string | null;
  action: 'confirm' | 'cancel';
}): Promise<{ messages: string[]; appointment: Appointment; early?: boolean } | null> {
  const appt = await loadForPatient(args.tenantId, args.appointmentId, args.phone);
  if (!appt || !['SCHEDULED', 'CONFIRMED'].includes(appt.status)) return null;

  const [profile] = await db
    .select({ scripts: tenantCareProfile.messageScripts })
    .from(tenantCareProfile)
    .where(eq(tenantCareProfile.tenantId, args.tenantId))
    .limit(1);
  const scripts = parseMessageScripts(profile?.scripts);
  const [settings] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, args.tenantId))
    .limit(1);
  const tz = settings?.timezone || 'Europe/Madrid';
  const v = vars(appt, tz, await firstNameOf(appt));
  const ctx = systemAgendaContext(args.tenantId);

  if (args.action === 'confirm') {
    // Antes del día no se confirma nada: la confirmación obligatoria es la del
    // recordatorio del MISMO día (lo pidió la clínica: "es sólo el
    // recordatorio, no hace falta que me confirmes ahora; el martes lo
    // volverás a recibir"). Marcarla aquí tapaba ese recordatorio.
    const isTodayAppt = localDateKey(appt.startsAt, tz) === localDateKey(new Date(), tz);
    if (!isTodayAppt) {
      const day = appt.startsAt.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: tz,
      });
      const at = scripts?.dayOf?.reminderAt ? ` a las ${scripts.dayOf.reminderAt}` : '';
      const cancelAt = scripts?.dayOf?.cancelAt ? ` antes de las ${scripts.dayOf.cancelAt}` : '';
      return {
        early: true,
        appointment: appt,
        messages: [
          `Perfecto 😊 Tomamos nota. La cita de ${v.paciente ?? 'tu peque'} sigue el ${day} a las ${v.hora}.\n\nEse mismo día${at} te llegará el recordatorio: ese sí hay que contestarlo${cancelAt} para confirmar la cita. Muchas gracias✨`,
        ],
      };
    }
    if (appt.status === 'SCHEDULED') {
      await updateAppointment(ctx, appt.id, { status: 'CONFIRMED' });
    }
    await markOutcome(appt, 'CONFIRMED');
    const dayOf = scripts?.dayOf;
    const messages: string[] = [];
    if (dayOf?.confirmed) messages.push(fillScript(dayOf.confirmed, v));
    return { messages, appointment: appt };
  }

  await updateAppointment(ctx, appt.id, {
    status: 'CANCELLED',
    cancelledBy: 'PATIENT',
    cancelReason: 'Cancelada por la familia desde WhatsApp',
  });
  await markOutcome(appt, 'CANCELLED');
  const text = scripts?.dayOf?.cancelled ?? scripts?.cancelled;
  return {
    messages: text ? [fillScript(text.replaceAll('(nombre)', '{{paciente}}'), v)] : [],
    appointment: appt,
  };
}

/**
 * Botón del recordatorio del día. Confirmar y cancelar se resuelven aquí y se
 * contesta con los guiones; Modificar pasa la conversación al asistente con
 * la cita a mover, igual que el "Reagendar" de los recordatorios.
 */
export async function handleDayOfButton(args: {
  tenantId: string;
  conversationId: string;
  contactPhoneE164: string;
  rawButtonId: string;
  inboundMessageId: string;
}): Promise<boolean> {
  const m = DAY_OF_BUTTON_RE.exec(args.rawButtonId);
  if (!m) return false;
  const action = (m[1] as string).toLowerCase() as DayOfAction;
  const appointmentId = m[2] as string;

  if (action === 'modify') {
    const appt = await loadForPatient(args.tenantId, appointmentId, args.contactPhoneE164);
    if (!appt) return false;
    await markOutcome(appt, 'MODIFY');
    await db
      .update(whatsappConversations)
      .set({
        status: 'ACTIVE',
        aiEnabled: true,
        context: {
          remindersResume: {
            reminderId: appointmentId,
            action: 'reschedule',
            ghlAppointmentId: appointmentId,
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          },
        } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappConversations.tenantId, args.tenantId),
          eq(whatsappConversations.id, args.conversationId),
        ),
      );
    await sendQueueEvent('wa-process', {
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      messageId: args.inboundMessageId,
      contactPhoneE164: args.contactPhoneE164,
    });
    return true;
  }

  const answer = await answerDayOf({
    tenantId: args.tenantId,
    appointmentId,
    phone: args.contactPhoneE164,
    action,
  });
  if (!answer) return false;
  if (answer.messages.length) {
    // La cita ya quedó confirmada o anulada: si falla la contestación, el
    // mensaje NO debe ir además al asistente (lo procesaría otra vez).
    await sendClinicWhatsapp(args.tenantId, args.contactPhoneE164, answer.messages).catch((err) =>
      console.warn('[day-of] no se pudo contestar al paciente', (err as Error).message),
    );
  }
  return true;
}

/**
 * Manda AHORA el recordatorio del día de una cita, con sus botones, sin
 * tocar la secuencia: el de las 08:00 sale igual el día de la cita. Es para
 * probarlo o reenviarlo a mano desde la hoja de la cita.
 */
export async function sendDayOfReminderNow(
  tenantId: string,
  appointmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [profile] = await db
    .select({ scripts: tenantCareProfile.messageScripts })
    .from(tenantCareProfile)
    .where(eq(tenantCareProfile.tenantId, tenantId))
    .limit(1);
  const dayOf = parseMessageScripts(profile?.scripts)?.dayOf;
  if (!dayOf)
    return { ok: false, error: 'Esta clínica no tiene configurado el recordatorio del día.' };
  const [appt] = await db
    .select()
    .from(agendaAppointments)
    .where(and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.id, appointmentId)))
    .limit(1);
  if (!appt) return { ok: false, error: 'No encuentro la cita.' };
  if (!appt.patientPhone) return { ok: false, error: 'La cita no tiene teléfono.' };
  const [settings] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  const tz = settings?.timezone || 'Europe/Madrid';
  // El guion dice "tu cita de hoy": si la cita es otro día, se dice ese día
  // ("de mañana, miércoles 4 de noviembre"). Mandarlo con "hoy" para una cita
  // de mañana confundía a las familias.
  const todayKey = localDateKey(new Date(), tz);
  const apptKey = localDateKey(appt.startsAt, tz);
  let text = fillScript(dayOf.reminder, vars(appt, tz, await firstNameOf(appt)));
  if (apptKey !== todayKey) {
    const long = appt.startsAt.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: tz,
    });
    const rel = relativeDayLabel(apptKey, todayKey);
    const label =
      rel === 'mañana' || rel === 'pasado mañana' ? `de ${rel}, ${long},` : `del ${long},`;
    text = text.replace(/\bde hoy\b/i, label).replace(/\bhoy\b/i, long);
  }
  const sent = await sendClinicWhatsapp(tenantId, appt.patientPhone, [text], dayOfButtons(appt.id));
  if (!sent) return { ok: false, error: 'WhatsApp no está conectado.' };
  // Cuenta como recordatorio mandado: así "1", "confirmado" o "nos vemos" lo
  // confirman. Si la cita es otro día, el tick de ese día lo vuelve a mandar
  // a su hora (mira sólo lo enviado ese mismo día).
  const at = new Date();
  await db
    .insert(appointmentDayOf)
    .values({ appointmentId: appt.id, tenantId, reminderSentAt: at })
    .onConflictDoUpdate({
      target: appointmentDayOf.appointmentId,
      set: { reminderSentAt: at, updatedAt: at },
    });
  return { ok: true };
}

/**
 * Respuesta escrita al recordatorio del día ("1", "confirmar"…). Sólo actúa
 * si lo último que le mandamos fue ese recordatorio (hace menos de 18 h) y hay
 * UNA sola cita pendiente en ese teléfono; con varias (hermanos) lo resuelve
 * el asistente, que sabe preguntar por cuál.
 */
export async function handleDayOfTextReply(args: {
  tenantId: string;
  conversationId: string;
  contactPhoneE164: string;
  text: string | null | undefined;
  inboundMessageId: string;
  /** Cuándo lo escribió la familia (puede llegar tarde si el canal falla). */
  writtenAt?: Date | null;
}): Promise<boolean> {
  // ¿Hay un recordatorio del día de HOY mandado a este teléfono y sin
  // respuesta? Antes se miraba si el último mensaje llevaba los botones, y el
  // segundo aviso de las 09:00 no los lleva: "Confirmado" a las 09:02 se iba
  // al asistente y la cita se quedaba sin confirmar.
  const now = new Date();
  const pending = await db
    .select({
      id: agendaAppointments.id,
      phone: agendaAppointments.patientPhone,
      reminderSentAt: appointmentDayOf.reminderSentAt,
      outcome: appointmentDayOf.outcome,
    })
    .from(agendaAppointments)
    .innerJoin(appointmentDayOf, eq(appointmentDayOf.appointmentId, agendaAppointments.id))
    .where(
      and(
        eq(agendaAppointments.tenantId, args.tenantId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
        gte(agendaAppointments.startsAt, now),
        lt(agendaAppointments.startsAt, new Date(now.getTime() + 36 * 3_600_000)),
        // NEEDS_CALL: no se anuló por dudas del canal; su "1" tardío sigue valiendo.
        or(isNull(appointmentDayOf.outcome), eq(appointmentDayOf.outcome, 'NEEDS_CALL')),
        gte(appointmentDayOf.reminderSentAt, new Date(now.getTime() - 18 * 3_600_000)),
      ),
    );
  const mine: typeof pending = [];
  for (const a of pending) {
    // Un "1" escrito ANTES del recordatorio de hoy (contestaba a otro mensaje y
    // llega tarde) no confirma la cita de hoy.
    if (args.writtenAt && a.reminderSentAt && args.writtenAt < a.reminderSentAt) continue;
    if (samePhone(a.phone, args.contactPhoneE164)) {
      mine.push(a);
      continue;
    }
    // Una cita sin teléfono propio avisa al titular de la ficha: su "1" vale.
    const [full] = await db
      .select()
      .from(agendaAppointments)
      .where(and(eq(agendaAppointments.tenantId, args.tenantId), eq(agendaAppointments.id, a.id)))
      .limit(1);
    if (
      full?.patientId &&
      (await dayOfRecipients(full)).some((r) => samePhone(r, args.contactPhoneE164))
    )
      mine.push(a);
  }
  if (mine.length !== 1) return false;

  const action = parseDayOfTextReply(args.text, true);
  if (!action) return false;

  return handleDayOfButton({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    contactPhoneE164: args.contactPhoneE164,
    rawButtonId: `dayof:${action}:${(mine[0] as { id: string }).id}`,
    inboundMessageId: args.inboundMessageId,
  });
}
