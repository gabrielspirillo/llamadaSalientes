import 'server-only';
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
} from 'drizzle-orm';

import { NEXT_DAYS, rankAdvanceCandidates } from '@/lib/agenda/advance-ranking';
import { systemAgendaContext } from '@/lib/agenda/agent';
import { samePhone } from '@/lib/agenda/patients';
import { createAppointment, rescheduleAppointment, updateAppointment } from '@/lib/agenda/service';
import { clinicBookingMessages } from '@/lib/care-profile/booking-confirmation';
import { sendClinicWhatsapp } from '@/lib/care-profile/clinic-whatsapp';
import { parseMessageScripts } from '@/lib/care-profile/messages';
import { getTenant } from '@/lib/data/clinic';
import { db } from '@/lib/db/client';
import {
  advanceOffers,
  agendaAppointments,
  appointmentDayOf,
  clinicSettings,
  professionalTimeOff,
  professionals,
  slotPriorityRequests,
  tenantCareProfile,
  treatments,
} from '@/lib/db/schema';
import { postSystemEvent } from '@/lib/messaging/bot';
import { getPatientPerson } from '@/lib/patients/persons';
import { addDaysToKey, localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { relativeDayLabel } from '@/lib/whatsapp/agent/slot-mention';

/**
 * Cuando se libera un hueco, se le ofrece PRIMERO a las familias que marcaron
 * "quiere adelantar" (↑ en el calendario) con el mismo profesional y cita
 * posterior, de una en una y por orden de cita. Mientras contestan, el hueco
 * queda reservado con un bloqueo para que nadie lo coja. Si dicen que no o no
 * contestan en el plazo, pasa a la siguiente; cuando no queda nadie, el hueco
 * sigue el camino de siempre (lista de espera).
 */

import { HOLD_REASON } from '@/lib/agenda/shared';
export { HOLD_REASON };
/** Lo que tiene cada familia para contestar (la clínica: 45 min el 5/11, 20 min el 6/11). */
const HOLD_MS = 20 * 60_000;

/**
 * Lo que se le dice a la familia del plazo, con las palabras de la clínica:
 * "Si en un plazo de 20 minutos no tenemos respuesta, se ofrecerá a otro
 * peque" (o "si antes de las 16:30…" cuando el hueco está cerca).
 */
export function validityLine(now: Date, expiresAt: Date, tz: string): string {
  const mins = Math.round((expiresAt.getTime() - now.getTime()) / 60_000);
  if (mins >= HOLD_MS / 60_000 - 1) {
    return `Si en un plazo de ${HOLD_MS / 60_000} minutos no tenemos respuesta, se ofrecerá a otro peque.`;
  }
  const p = localParts(expiresAt, tz);
  return `Si antes de las ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} no tenemos respuesta, se ofrecerá a otro peque.`;
}
const MIN_LEAD_MS = 45 * 60_000;

export interface FreedSlot {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  /** La cita que dejó el hueco, si fue una cancelación. */
  freedAppointmentId?: string | null;
  cancelledSlotId?: string | null;
}

/** Sin citas vivas ni bloqueos (que no sean una reserva de oferta) sobre el hueco. */
export async function slotIsFree(tenantId: string, slot: FreedSlot): Promise<boolean> {
  const busy = await db
    .select({ id: agendaAppointments.id })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        eq(agendaAppointments.professionalId, slot.professionalId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS']),
        lt(agendaAppointments.startsAt, slot.endsAt),
        gt(agendaAppointments.endsAt, slot.startsAt),
        ...(slot.freedAppointmentId ? [ne(agendaAppointments.id, slot.freedAppointmentId)] : []),
      ),
    )
    .limit(1);
  if (busy.length) return false;
  const blocks = await db
    .select({ id: professionalTimeOff.id, reason: professionalTimeOff.reason })
    .from(professionalTimeOff)
    .where(
      and(
        eq(professionalTimeOff.tenantId, tenantId),
        eq(professionalTimeOff.professionalId, slot.professionalId),
        lt(professionalTimeOff.startsAt, slot.endsAt),
        gt(professionalTimeOff.endsAt, slot.startsAt),
      ),
    );
  return blocks.every((b) => b.reason === HOLD_REASON);
}

function dayStart(key: string, tz: string): Date {
  const p = parseDateKey(key);
  return p ? zonedToUtc(p.year, p.month, p.day, 0, 0, tz) : new Date();
}

async function tenantTimezone(tenantId: string): Promise<string> {
  const [s] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return s?.timezone || 'Europe/Madrid';
}

function describe(d: Date, tz: string, todayKey: string): { day: string; time: string } {
  const p = localParts(d, tz);
  const key = localDateKey(d, tz);
  const rel = relativeDayLabel(key, todayKey);
  const long = d.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  });
  const day = rel === 'hoy' || rel === 'mañana' ? `${rel} (${long})` : long;
  return { day, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` };
}

/**
 * Ofrece el hueco a la siguiente familia candidata. Devuelve true si se mandó
 * una oferta (y el hueco queda reservado); false si no había a quién.
 */
export async function offerFreedSlot(
  tenantId: string,
  slot: FreedSlot,
  now = new Date(),
): Promise<boolean> {
  const slotMs = slot.endsAt.getTime() - slot.startsAt.getTime();
  if (slotMs <= 0 || slot.startsAt.getTime() - now.getTime() < MIN_LEAD_MS) return false;
  const { isTenantArchived } = await import('@/lib/tenants/archive');
  if (await isTenantArchived(tenantId)) return false;
  const expiresAt = new Date(
    Math.min(now.getTime() + HOLD_MS, slot.startsAt.getTime() - 30 * 60_000),
  );
  if (expiresAt.getTime() - now.getTime() < 10 * 60_000) return false;

  // ⚠️ El hueco tiene que estar LIBRE de verdad. El 5 de noviembre se ofreció
  // a tres familias un hueco de las 18:00 que seguía ocupado: la cancelación
  // que lo "liberó" era de una cita solapada con otra que seguía en pie. Si
  // hay una cita viva o un bloqueo ajeno sobre ese rato, no se ofrece nada.
  if (!(await slotIsFree(tenantId, slot))) {
    console.warn('[adelanto] el hueco no está libre, no se ofrece', {
      tenantId,
      professionalId: slot.professionalId,
      startsAt: slot.startsAt.toISOString(),
    });
    return false;
  }

  // Ya ofrecido para este hueco a alguien que dijo que no (o no contestó).
  const already = await db
    .select({
      appointmentId: advanceOffers.appointmentId,
      requestId: advanceOffers.requestId,
      status: advanceOffers.status,
    })
    .from(advanceOffers)
    .where(
      and(
        eq(advanceOffers.tenantId, tenantId),
        eq(advanceOffers.professionalId, slot.professionalId),
        eq(advanceOffers.slotStartsAt, slot.startsAt),
      ),
    );
  if (already.some((o) => o.status === 'SENT')) return true;
  // Sólo quien dijo que no o no contestó. Una oferta CANCELADA (el hueco se
  // ocupó mientras tanto) no es culpa de la familia: si vuelve a liberarse,
  // se le vuelve a ofrecer.
  const refused = already.filter((o) => o.status === 'DECLINED' || o.status === 'EXPIRED');
  const skip = new Set(refused.map((o) => o.appointmentId).filter((id): id is string => !!id));
  const skipRequests = new Set(refused.map((o) => o.requestId).filter((id): id is string => !!id));
  const tz0 = await tenantTimezone(tenantId);

  // 0. Antes que nadie, el paciente que la clínica eligió para el primer
  // hueco que se libere ("la niña que está muy malita").
  if (await offerToPriorityRequest(tenantId, slot, tz0, now, expiresAt, skipRequests)) {
    return true;
  }

  // Ventana: los tres días siguientes al hueco (`rankAdvanceCandidates`; en el
  // mismo día no se mueve a nadie). Quien dijo "no mover" no se trae.
  const windowEnd = dayStart(addDaysToKey(localDateKey(slot.startsAt, tz0), NEXT_DAYS + 1), tz0);
  const candidates = await db
    .select()
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        eq(agendaAppointments.professionalId, slot.professionalId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
        or(
          eq(agendaAppointments.advancePreference, 'ACCEPTS'),
          isNull(agendaAppointments.advancePreference),
        ),
        isNotNull(agendaAppointments.patientPhone),
        gte(agendaAppointments.startsAt, slot.endsAt),
        lt(agendaAppointments.startsAt, windowEnd),
        ...(slot.freedAppointmentId ? [ne(agendaAppointments.id, slot.freedAppointmentId)] : []),
        ...(skip.size ? [notInArray(agendaAppointments.id, [...skip])] : []),
      ),
    );
  // Nunca a la familia que dejó el hueco: el 6/11 una madre cambió la cita del
  // miércoles al viernes, el miércoles quedó libre y se le ofreció a ella misma
  // (su cita del viernes era "misma hora, días siguientes").
  const [freed] = slot.freedAppointmentId
    ? await db
        .select({
          patientId: agendaAppointments.patientId,
          patientKey: agendaAppointments.patientKey,
        })
        .from(agendaAppointments)
        .where(
          and(
            eq(agendaAppointments.tenantId, tenantId),
            eq(agendaAppointments.id, slot.freedAppointmentId),
          ),
        )
        .limit(1)
    : [];
  const samePatient = (c: (typeof candidates)[number]) =>
    !!freed &&
    ((!!freed.patientId && c.patientId === freed.patientId) ||
      (!!freed.patientKey && c.patientKey === freed.patientKey));
  const pendingIds = new Set(
    (
      await db
        .select({ appointmentId: advanceOffers.appointmentId })
        .from(advanceOffers)
        .where(and(eq(advanceOffers.tenantId, tenantId), eq(advanceOffers.status, 'SENT')))
    )
      .map((o) => o.appointmentId)
      .filter((id): id is string => !!id),
  );
  const ranked = rankAdvanceCandidates(
    { startsAt: slot.startsAt, endsAt: slot.endsAt },
    candidates.filter((c) => !pendingIds.has(c.id) && c.patientPhone && !samePatient(c)),
    tz0,
  );
  const first = ranked[0];
  const target = first?.candidate;
  if (!target || !target.patientPhone) return false;

  const [professional] = await db
    .select({ name: professionals.fullName })
    .from(professionals)
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, slot.professionalId)))
    .limit(1);
  const tz = tz0;
  const [tenant, person] = await Promise.all([
    getTenant(tenantId),
    target.patientId ? getPatientPerson(tenantId, target.patientId).catch(() => null) : null,
  ]);
  const todayKey = localDateKey(now, tz);
  const hueco = describe(slot.startsAt, tz, todayKey);
  const cita = describe(target.startsAt, tz, todayKey);
  const guardian =
    person?.guardians.find((g) => g.primary && g.name) ?? person?.guardians.find((g) => g.name);
  const patientName = person?.firstName ?? target.patientName.split(/\s+/)[0] ?? 'vuestro peque';
  const hello = guardian?.name ? `Hola ${guardian.name.split(/\s+/)[0]}` : 'Hola';

  // Reservar el hueco mientras contestan.
  const [hold] = await db
    .insert(professionalTimeOff)
    .values({
      tenantId,
      professionalId: slot.professionalId,
      startsAt: slot.startsAt,
      endsAt: new Date(
        slot.startsAt.getTime() + (target.endsAt.getTime() - target.startsAt.getTime()),
      ),
      allDay: false,
      kind: 'OTHER',
      reason: HOLD_REASON,
    })
    .returning({ id: professionalTimeOff.id });

  const [offer] = await db
    .insert(advanceOffers)
    .values({
      tenantId,
      appointmentId: target.id,
      professionalId: slot.professionalId,
      freedAppointmentId: slot.freedAppointmentId ?? null,
      cancelledSlotId: slot.cancelledSlotId ?? null,
      slotStartsAt: slot.startsAt,
      slotEndsAt: slot.endsAt,
      holdBlockId: hold?.id ?? null,
      phoneE164: target.patientPhone,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: advanceOffers.id });
  if (!offer) {
    if (hold) await db.delete(professionalTimeOff).where(eq(professionalTimeOff.id, hold.id));
    return false;
  }

  const clinic = tenant?.name?.trim() || 'la clínica';
  const ask =
    target.advancePreference !== 'ACCEPTS'
      ? `Tenéis la cita de ${patientName} el ${cita.day} a las ${cita.time}. ¿Os vendría bien adelantarla a ese hueco?`
      : `Nos dijisteis que queríais adelantar la cita de ${patientName} del ${cita.day} a las ${cita.time}. ¿Os la cambiamos a ese hueco?`;
  const withWhom = professional ? ` con ${professional.name}` : '';
  const text = `${hello}, soy el asistente virtual de la agenda de ${clinic}. Se ha liberado un hueco ${hueco.day} a las ${hueco.time}${withWhom}. ${ask}\n\n${validityLine(now, expiresAt, tz)}`;
  const sent = await sendClinicWhatsapp(
    tenantId,
    target.patientPhone,
    [text],
    [
      { id: `adv:yes:${offer.id}`, title: 'Sí, cambiarla' },
      { id: `adv:no:${offer.id}`, title: 'No, dejarla' },
    ],
  ).catch((err) => {
    console.warn('[adelanto] no se pudo mandar la oferta', (err as Error).message);
    return false;
  });
  if (!sent) {
    await closeOffer(offer.id, 'CANCELLED');
    return false;
  }
  await postSystemEvent({
    tenantId,
    event: 'waitlist.slot_open',
    title: `Hueco ofrecido para adelantar — ${hueco.day} ${hueco.time}`,
    body: `Se le ofreció a ${target.patientName} (cita del ${cita.day} a las ${cita.time}). El hueco queda reservado hasta que conteste.`,
    dedupeKey: `adv:offer:${offer.id}`,
  }).catch(() => undefined);
  return true;
}

/**
 * El hueco, para el paciente que la clínica marcó desde su ficha ("primer
 * hueco que se libere"), si el día y el profesional encajan. Tenga o no cita:
 * si acepta, se le crea una nueva.
 */
async function offerToPriorityRequest(
  tenantId: string,
  slot: FreedSlot,
  tz: string,
  now: Date,
  expiresAt: Date,
  skipRequests: Set<string>,
): Promise<boolean> {
  const slotDay = localDateKey(slot.startsAt, tz);
  const requests = await db
    .select()
    .from(slotPriorityRequests)
    .where(
      and(
        eq(slotPriorityRequests.tenantId, tenantId),
        eq(slotPriorityRequests.status, 'ACTIVE'),
        lte(slotPriorityRequests.fromDay, slotDay),
        gte(slotPriorityRequests.untilDay, slotDay),
        or(
          isNull(slotPriorityRequests.professionalId),
          eq(slotPriorityRequests.professionalId, slot.professionalId),
        ),
      ),
    )
    .orderBy(slotPriorityRequests.createdAt);
  if (requests.length === 0) return false;
  const pending = new Set(
    (
      await db
        .select({ requestId: advanceOffers.requestId })
        .from(advanceOffers)
        .where(and(eq(advanceOffers.tenantId, tenantId), eq(advanceOffers.status, 'SENT')))
    )
      .map((o) => o.requestId)
      .filter((id): id is string => !!id),
  );
  const req = requests.find((r) => !skipRequests.has(r.id) && !pending.has(r.id));
  if (!req) return false;

  const slotMinutes = Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000);
  let minutes = slotMinutes;
  if (req.treatmentId) {
    const [t] = await db
      .select({ duration: treatments.durationMinutes })
      .from(treatments)
      .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, req.treatmentId)))
      .limit(1);
    if (t?.duration && t.duration > slotMinutes) return false; // no cabe
    if (t?.duration) minutes = t.duration;
  }

  const [professional] = await db
    .select({ name: professionals.fullName })
    .from(professionals)
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, slot.professionalId)))
    .limit(1);
  const [tenant, person] = await Promise.all([
    getTenant(tenantId),
    req.patientId ? getPatientPerson(tenantId, req.patientId).catch(() => null) : null,
  ]);
  const guardian =
    person?.guardians.find((g) => g.primary && g.name) ?? person?.guardians.find((g) => g.name);
  const hello = guardian?.name ? `Hola ${guardian.name.split(/\s+/)[0]}` : 'Hola';
  const firstName = person?.firstName ?? req.patientName.split(/\s+/)[0] ?? 'vuestro peque';
  const hueco = describe(slot.startsAt, tz, localDateKey(now, tz));

  const [hold] = await db
    .insert(professionalTimeOff)
    .values({
      tenantId,
      professionalId: slot.professionalId,
      startsAt: slot.startsAt,
      endsAt: new Date(slot.startsAt.getTime() + minutes * 60_000),
      allDay: false,
      kind: 'OTHER',
      reason: HOLD_REASON,
    })
    .returning({ id: professionalTimeOff.id });
  const [offer] = await db
    .insert(advanceOffers)
    .values({
      tenantId,
      appointmentId: null,
      requestId: req.id,
      professionalId: slot.professionalId,
      freedAppointmentId: slot.freedAppointmentId ?? null,
      cancelledSlotId: slot.cancelledSlotId ?? null,
      slotStartsAt: slot.startsAt,
      slotEndsAt: new Date(slot.startsAt.getTime() + minutes * 60_000),
      holdBlockId: hold?.id ?? null,
      phoneE164: req.phoneE164,
      expiresAt,
    })
    .onConflictDoNothing()
    .returning({ id: advanceOffers.id });
  if (!offer) {
    if (hold) await db.delete(professionalTimeOff).where(eq(professionalTimeOff.id, hold.id));
    return false;
  }
  const clinic = tenant?.name?.trim() || 'la clínica';
  const withWhom = professional ? ` con ${professional.name}` : '';
  const text = `${hello}, soy el asistente virtual de la agenda de ${clinic}. Se ha liberado un hueco ${hueco.day} a las ${hueco.time}${withWhom} y la clínica nos ha pedido ofrecéroslo para ${firstName}. ¿Os lo reservamos?\n\n${validityLine(now, expiresAt, tz)}`;
  const sent = await sendClinicWhatsapp(
    tenantId,
    req.phoneE164,
    [text],
    [
      { id: `adv:yes:${offer.id}`, title: 'Sí, reservar' },
      { id: `adv:no:${offer.id}`, title: 'No, gracias' },
    ],
  ).catch((err) => {
    console.warn('[adelanto] no se pudo mandar la oferta prioritaria', (err as Error).message);
    return false;
  });
  if (!sent) {
    await closeOffer(offer.id, 'CANCELLED');
    return false;
  }
  await postSystemEvent({
    tenantId,
    event: 'waitlist.slot_open',
    title: `Hueco ofrecido con prioridad — ${hueco.day} ${hueco.time}`,
    body: `Se le ofreció a ${req.patientName}, que la clínica marcó para el primer hueco que se liberara. El hueco queda reservado hasta que conteste.`,
    dedupeKey: `adv:offer:${offer.id}`,
  }).catch(() => undefined);
  return true;
}

/** "Sí" a una oferta prioritaria: cita nueva y la confirmación de siempre. */
async function bookPriorityRequest(
  row: typeof advanceOffers.$inferSelect,
  tz: string,
  todayKey: string,
): Promise<{ messages: string[] }> {
  const [req] = await db
    .select()
    .from(slotPriorityRequests)
    .where(
      and(
        eq(slotPriorityRequests.tenantId, row.tenantId),
        eq(slotPriorityRequests.id, row.requestId as string),
      ),
    )
    .limit(1);
  if (!req) return { messages: [] };
  const minutes = Math.round((row.slotEndsAt.getTime() - row.slotStartsAt.getTime()) / 60_000);
  try {
    const { appointment } = await createAppointment(systemAgendaContext(row.tenantId), {
      professionalId: row.professionalId,
      treatmentId: req.treatmentId,
      patientId: req.patientId,
      patientName: req.patientName,
      patientPhone: req.phoneE164,
      startsAt: row.slotStartsAt.toISOString(),
      durationMinutes: minutes,
      source: 'WAITLIST',
      allowOutsideHours: true,
      overridePolicy: true,
      dedupeKey: `prio:${row.id}`,
    });
    await db
      .update(slotPriorityRequests)
      .set({ status: 'BOOKED', updatedAt: new Date() })
      .where(eq(slotPriorityRequests.id, req.id));
    const when = describe(row.slotStartsAt, tz, todayKey);
    await postSystemEvent({
      tenantId: row.tenantId,
      event: 'waitlist.slot_open',
      title: `Cita dada con prioridad — ${when.day} ${when.time}`,
      body: `${req.patientName} aceptó el hueco que la clínica le reservó.`,
      dedupeKey: `adv:accepted:${row.id}`,
    }).catch(() => undefined);
    const person = req.patientId
      ? await getPatientPerson(row.tenantId, req.patientId).catch(() => null)
      : null;
    const confirmation = await clinicBookingMessages(
      row.tenantId,
      {
        startsAt: appointment.startsAt,
        patientId: appointment.patientId ?? null,
        patientFirstName: person?.firstName ?? req.patientName.split(/\s+/)[0] ?? null,
        isFirstVisit: Boolean(appointment.isFirstVisit),
        timezone: tz,
      },
      req.phoneE164,
    );
    return {
      messages: confirmation.length
        ? confirmation
        : [`¡Hecho! La cita queda ${when.day} a las ${when.time}. Os esperamos.`],
    };
  } catch (err) {
    console.warn('[adelanto] no se pudo dar la cita prioritaria', (err as Error).message);
    await db.update(advanceOffers).set({ status: 'CANCELLED' }).where(eq(advanceOffers.id, row.id));
    return {
      messages: [
        'Lo sentimos, ese hueco acaba de ocuparse. Seguimos pendientes y os avisamos si se libera otro.',
      ],
    };
  }
}

async function closeOffer(
  offerId: string,
  status: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED',
) {
  const [row] = await db
    .update(advanceOffers)
    .set({ status, answeredAt: new Date() })
    .where(and(eq(advanceOffers.id, offerId), eq(advanceOffers.status, 'SENT')))
    .returning();
  if (row?.holdBlockId) {
    await db.delete(professionalTimeOff).where(eq(professionalTimeOff.id, row.holdBlockId));
  }
  return row ?? null;
}

/** Tras un "no" o un plazo vencido: siguiente familia o, si no hay, lista de espera. */
async function passToNext(row: typeof advanceOffers.$inferSelect): Promise<void> {
  const offered = await offerFreedSlot(row.tenantId, {
    professionalId: row.professionalId,
    startsAt: row.slotStartsAt,
    endsAt: row.slotEndsAt,
    freedAppointmentId: row.freedAppointmentId,
    cancelledSlotId: row.cancelledSlotId,
  }).catch(() => false);
  if (offered || !row.cancelledSlotId) return;
  const { enqueueOfferForCancelledSlot } = await import('@/lib/waitlist/engine');
  await enqueueOfferForCancelledSlot(row.tenantId, row.cancelledSlotId).catch((err) =>
    console.warn('[adelanto] oferta de lista de espera', (err as Error).message),
  );
}

export function parseAdvanceReply(text: string | null | undefined): 'yes' | 'no' | null {
  const t = (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 60) return null;
  if (
    /^(1|si|sii+|vale|ok|okey|claro|perfecto|genial|por favor|cambiar|cambiarla|cambiala|adelantar|adelantarla|queremos|si por favor|si claro|si vale|si cambiarla|si cambiadla|si queremos)\b/.test(
      t,
    )
  )
    return 'yes';
  if (/^(2|no|no gracias|dejarla|dejadla|dejala|mejor no|no dejarla|no dejadla)\b/.test(t))
    return 'no';
  return null;
}

async function pendingOfferFor(tenantId: string, phone: string) {
  const rows = await db
    .select()
    .from(advanceOffers)
    .where(
      and(
        eq(advanceOffers.tenantId, tenantId),
        eq(advanceOffers.status, 'SENT'),
        gte(advanceOffers.expiresAt, new Date()),
      ),
    );
  const mine = rows.filter((r) => samePhone(r.phoneE164, phone));
  return mine.length === 1 ? (mine[0] as (typeof rows)[number]) : null;
}

async function resolveOffer(
  row: typeof advanceOffers.$inferSelect,
  answer: 'yes' | 'no',
): Promise<{ messages: string[]; after?: () => Promise<void> }> {
  const tz = await tenantTimezone(row.tenantId);
  const todayKey = localDateKey(new Date(), tz);
  if (answer === 'no') {
    await closeOffer(row.id, 'DECLINED');
    return {
      messages: [
        row.requestId
          ? 'Vale, no pasa nada. ¡Gracias por contestar!'
          : 'Vale, dejamos la cita como estaba. ¡Gracias por contestar!',
      ],
      after: () => passToNext(row),
    };
  }
  // Antes de tocar nada: el hueco tiene que seguir libre (sin contar nuestra
  // propia reserva). Si alguien lo ocupó a mano, se le dice y no se mueve.
  const stillFree = await slotIsFree(row.tenantId, {
    professionalId: row.professionalId,
    startsAt: row.slotStartsAt,
    endsAt: row.slotEndsAt,
  });
  if (!stillFree) {
    await closeOffer(row.id, 'CANCELLED');
    return {
      messages: [
        'Lo sentimos, ese hueco acaba de ocuparse. Vuestra cita sigue como estaba y os avisaremos si se libera otro.',
      ],
    };
  }
  const closed = await closeOffer(row.id, 'ACCEPTED');
  if (!closed) return { messages: [] };
  if (row.requestId) return bookPriorityRequest(row, tz, todayKey);
  if (!row.appointmentId) return { messages: [] };
  const appointmentId = row.appointmentId;
  const [before] = await db
    .select({
      startsAt: agendaAppointments.startsAt,
      endsAt: agendaAppointments.endsAt,
      patientName: agendaAppointments.patientName,
    })
    .from(agendaAppointments)
    .where(
      and(eq(agendaAppointments.tenantId, row.tenantId), eq(agendaAppointments.id, appointmentId)),
    )
    .limit(1);
  try {
    await rescheduleAppointment(systemAgendaContext(row.tenantId), appointmentId, {
      startsAt: row.slotStartsAt.toISOString(),
      allowOutsideHours: true,
    });
  } catch (err) {
    console.warn('[adelanto] no se pudo mover la cita', (err as Error).message);
    await db.update(advanceOffers).set({ status: 'CANCELLED' }).where(eq(advanceOffers.id, row.id));
    return {
      messages: [
        'Lo sentimos, ese hueco acaba de ocuparse. Vuestra cita sigue como estaba y os avisaremos si se libera otro.',
      ],
    };
  }
  const when = describe(row.slotStartsAt, tz, todayKey);
  await postSystemEvent({
    tenantId: row.tenantId,
    event: 'waitlist.slot_open',
    title: `Cita adelantada — ${when.day} ${when.time}`,
    body: `${before?.patientName ?? 'La familia'} aceptó el hueco y su cita se movió.`,
    dedupeKey: `adv:accepted:${row.id}`,
  }).catch(() => undefined);
  // Adelantada a HOY: acaban de decir que vienen. Queda CONFIRMADA (sin el
  // recordatorio del día, que salía un minuto después del "¡Hecho!") y el
  // mensaje lleva las indicaciones de la clínica (ayuno, puntualidad), en uno
  // solo. Lo pidió la clínica el 6/11.
  let hecho = `¡Hecho! La cita queda ${when.day} a las ${when.time}. Os esperamos.`;
  if (localDateKey(row.slotStartsAt, tz) === todayKey) {
    await updateAppointment(systemAgendaContext(row.tenantId), appointmentId, {
      status: 'CONFIRMED',
    }).catch((err) => console.warn('[adelanto] confirmar cita de hoy', (err as Error).message));
    const at = new Date();
    await db
      .insert(appointmentDayOf)
      .values({ appointmentId, tenantId: row.tenantId, outcome: 'CONFIRMED', outcomeAt: at })
      .onConflictDoUpdate({
        target: appointmentDayOf.appointmentId,
        set: { outcome: 'CONFIRMED', outcomeAt: at, updatedAt: at },
      })
      .catch((err) => console.warn('[adelanto] marcar confirmada', (err as Error).message));
    const reminder = await dayOfReminderTail(row.tenantId);
    hecho = `¡Hecho! ✨\nLa cita queda ${when.day} a las ${when.time}.${reminder ? `\n\n${reminder}` : ' Os esperamos.'}`;
  }
  return {
    messages: [hecho],
    // El hueco que deja la cita movida se ofrece al siguiente, ya contestada.
    after: before
      ? async () => {
          await offerFreedSlot(row.tenantId, {
            professionalId: row.professionalId,
            startsAt: before.startsAt,
            endsAt: before.endsAt,
            freedAppointmentId: appointmentId,
          }).catch(() => false);
        }
      : undefined,
  };
}

/**
 * Lo que la clínica recuerda al confirmar una cita de hoy ("Recuerda: 2 horas
 * de ayuno, puntualidad. Muchas gracias"): el guion `dayOf.confirmed` sin su
 * primer párrafo ("Perfecto, nos vemos esta tarde"), que aquí lo pone el "¡Hecho!".
 */
export function dayOfReminderTailFromScript(confirmed: string | null | undefined): string {
  const text = (confirmed ?? '').trim();
  if (!text) return '';
  const idx = text.search(/\n\s*\n/);
  return idx < 0 ? '' : text.slice(idx).trim();
}

async function dayOfReminderTail(tenantId: string): Promise<string> {
  const [profile] = await db
    .select({ scripts: tenantCareProfile.messageScripts })
    .from(tenantCareProfile)
    .where(eq(tenantCareProfile.tenantId, tenantId))
    .limit(1);
  return dayOfReminderTailFromScript(parseMessageScripts(profile?.scripts)?.dayOf?.confirmed);
}

/** Botón "adv:yes:<id>" / "adv:no:<id>" (Cloud API) . */
export async function handleAdvanceButton(args: {
  tenantId: string;
  contactPhoneE164: string;
  rawButtonId: string;
}): Promise<boolean> {
  const m = /^adv:(yes|no):([0-9a-f-]{36})$/i.exec(args.rawButtonId);
  if (!m) return false;
  const [row] = await db
    .select()
    .from(advanceOffers)
    .where(
      and(
        eq(advanceOffers.tenantId, args.tenantId),
        eq(advanceOffers.id, m[2] as string),
        eq(advanceOffers.status, 'SENT'),
      ),
    )
    .limit(1);
  if (!row || !samePhone(row.phoneE164, args.contactPhoneE164)) return false;
  const { messages, after } = await resolveOffer(row, m[1] === 'yes' ? 'yes' : 'no');
  if (messages.length)
    await sendClinicWhatsapp(args.tenantId, args.contactPhoneE164, messages).catch(() => false);
  if (after) await after();
  return true;
}

/**
 * El texto del mensaje al que la familia responde citándolo (Evolution manda
 * `contextInfo.quotedMessage`). Null si no cita nada.
 */
export function quotedTextFrom(raw: unknown): string | null {
  const at = (o: unknown, ...path: string[]): unknown =>
    path.reduce<unknown>(
      (acc, k) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined,
      o,
    );
  const q =
    at(raw, 'contextInfo', 'quotedMessage') ??
    at(raw, 'message', 'extendedTextMessage', 'contextInfo', 'quotedMessage');
  if (!q) return null;
  const text =
    at(q, 'conversation') ??
    at(q, 'extendedTextMessage', 'text') ??
    at(q, 'imageMessage', 'caption') ??
    at(q, 'buttonsMessage', 'contentText');
  return typeof text === 'string' ? text : '';
}

/**
 * ¿Esa respuesta citada es para la oferta? Si la familia cita OTRO mensaje
 * ("Ya tienes la cita reservada…" → "Sí, gracias"), no lo es. El 6/11 un "sí
 * gracias" a la confirmación de la cita se tomó como "sí" a la oferta y la
 * cita volvió a un día al que la familia no podía ir.
 */
export function quoteIsForOffer(quoted: string | null): boolean {
  if (quoted === null) return true;
  return /se ha liberado un hueco/i.test(quoted);
}

/** Respuesta escrita ("1", "sí", "no"…) de la familia a una oferta pendiente. */
export async function handleAdvanceTextReply(args: {
  tenantId: string;
  contactPhoneE164: string;
  text: string | null | undefined;
  /** Texto del mensaje citado, si la respuesta cita uno (`quotedTextFrom`). */
  quotedText?: string | null;
}): Promise<boolean> {
  if (!quoteIsForOffer(args.quotedText ?? null)) return false;
  const row = await pendingOfferFor(args.tenantId, args.contactPhoneE164);
  if (!row) return false;
  const answer = parseAdvanceReply(args.text);
  if (!answer) return false;
  const { messages, after } = await resolveOffer(row, answer);
  if (messages.length)
    await sendClinicWhatsapp(args.tenantId, args.contactPhoneE164, messages).catch(() => false);
  if (after) await after();
  return true;
}

/** Plazos vencidos: se libera el hueco y pasa al siguiente. Lo llama el tick del worker. */
export async function expireAdvanceOffers(now = new Date()): Promise<number> {
  const rows = await db
    .select()
    .from(advanceOffers)
    .where(and(eq(advanceOffers.status, 'SENT'), lte(advanceOffers.expiresAt, now)));
  for (const row of rows) {
    const closed = await closeOffer(row.id, 'EXPIRED');
    if (!closed) continue;
    await sendClinicWhatsapp(row.tenantId, row.phoneE164, [
      'No hemos recibido respuesta, así que dejamos vuestra cita como estaba. Si se libera otro hueco os avisamos.',
    ]).catch(() => false);
    await passToNext(row);
  }
  return rows.length;
}
