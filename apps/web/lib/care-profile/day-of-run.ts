import 'server-only';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';

import { systemAgendaContext } from '@/lib/agenda/agent';
import { samePhone } from '@/lib/agenda/patients';
import { updateAppointment } from '@/lib/agenda/service';
import { OPTIONS_MARKER, sendClinicWhatsapp } from '@/lib/care-profile/clinic-whatsapp';
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
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  appointmentDayOf,
  clinicSettings,
  tenantCareProfile,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { getPatientPerson } from '@/lib/patients/persons';
import { sendQueueEvent } from '@/lib/queue/client';
import { formatDateTime } from '@/lib/tasks/materialize';
import { localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';

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
  const profiles = await db
    .select({ tenantId: tenantCareProfile.tenantId, scripts: tenantCareProfile.messageScripts })
    .from(tenantCareProfile)
    .where(sql`${tenantCareProfile.messageScripts} ? 'dayOf'`);

  for (const profile of profiles) {
    const dayOf = parseMessageScripts(profile.scripts)?.dayOf;
    if (!dayOf) continue;
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
        eq(agendaAppointments.status, 'SCHEDULED'),
        gte(agendaAppointments.startsAt, now),
        lt(agendaAppointments.startsAt, dayEnd),
        lt(agendaAppointments.createdAt, dayStart),
        sql`${agendaAppointments.patientPhone} is not null`,
      ),
    );

  let done = 0;
  for (const { appt, state } of rows) {
    if (localDateKey(appt.startsAt, tz) !== localDateKey(now, tz)) continue;
    if (state?.outcome) continue;
    const p = localParts(appt.startsAt, tz);
    const step = nextDayOfStep({
      times: dayOf,
      state: {
        reminderSentAt: state?.reminderSentAt ?? null,
        nudgeSentAt: state?.nudgeSentAt ?? null,
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
      const sent = await sendClinicWhatsapp(
        appt.tenantId,
        phone,
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
    if (dayOf.nudge) await sendClinicWhatsapp(appt.tenantId, phone, [fillScript(dayOf.nudge, v)]);
    return true;
  }

  if (step.kind === 'call') {
    const claimed = await db
      .update(appointmentDayOf)
      .set({ callsDone: step.index + 1, updatedAt: at })
      .where(and(scope, eq(appointmentDayOf.callsDone, step.index)))
      .returning({ id: appointmentDayOf.appointmentId });
    if (!claimed.length) return false;
    await askTeamToCall(appt, tz, step.index);
    return true;
  }

  // cancel
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
  // Sólo quien recibe los avisos de esa cita puede contestar por ella.
  if (phone && appt.patientPhone && !samePhone(phone, appt.patientPhone)) return null;
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
}): Promise<{ messages: string[]; appointment: Appointment } | null> {
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
    if (appt.status === 'SCHEDULED') {
      await updateAppointment(ctx, appt.id, { status: 'CONFIRMED' });
    }
    await markOutcome(appt, 'CONFIRMED');
    const dayOf = scripts?.dayOf;
    const isToday = localDateKey(appt.startsAt, tz) === localDateKey(new Date(), tz);
    const messages: string[] = [];
    if (dayOf?.confirmed) {
      messages.push(
        isToday
          ? fillScript(dayOf.confirmed, v)
          : `Perfecto 😊 Queda confirmada la cita de ${v.paciente ?? 'tu peque'} a las ${v.hora}. Muchas gracias✨`,
      );
    }
    if (dayOf?.firstVisitInfo && appt.isFirstVisit) messages.push(dayOf.firstVisitInfo);
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
  const sent = await sendClinicWhatsapp(
    tenantId,
    appt.patientPhone,
    [fillScript(dayOf.reminder, vars(appt, tz, await firstNameOf(appt)))],
    dayOfButtons(appt.id),
  );
  return sent ? { ok: true } : { ok: false, error: 'WhatsApp no está conectado.' };
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
}): Promise<boolean> {
  const action = parseDayOfTextReply(args.text);
  if (!action) return false;

  const [lastOut] = await db
    .select({ text: whatsappMessages.contentText, at: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, args.tenantId),
        eq(whatsappMessages.conversationId, args.conversationId),
        eq(whatsappMessages.direction, 'OUTBOUND'),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  if (!lastOut?.text?.includes(OPTIONS_MARKER)) return false;
  if (Date.now() - lastOut.at.getTime() > 18 * 3_600_000) return false;

  const now = new Date();
  const pending = await db
    .select({ id: agendaAppointments.id, phone: agendaAppointments.patientPhone })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, args.tenantId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
        gte(agendaAppointments.startsAt, now),
        lt(agendaAppointments.startsAt, new Date(now.getTime() + 8 * 86_400_000)),
      ),
    );
  const mine = pending.filter((a) => samePhone(a.phone, args.contactPhoneE164));
  if (mine.length !== 1) return false;

  return handleDayOfButton({
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    contactPhoneE164: args.contactPhoneE164,
    rawButtonId: `dayof:${action}:${(mine[0] as { id: string }).id}`,
    inboundMessageId: args.inboundMessageId,
  });
}
