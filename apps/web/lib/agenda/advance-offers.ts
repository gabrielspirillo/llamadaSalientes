import 'server-only';
import { and, eq, gt, gte, inArray, isNotNull, lte, ne, notInArray } from 'drizzle-orm';

import { systemAgendaContext } from '@/lib/agenda/agent';
import { samePhone } from '@/lib/agenda/patients';
import { rescheduleAppointment } from '@/lib/agenda/service';
import { sendClinicWhatsapp } from '@/lib/care-profile/clinic-whatsapp';
import { getTenant } from '@/lib/data/clinic';
import { db } from '@/lib/db/client';
import {
  advanceOffers,
  agendaAppointments,
  clinicSettings,
  professionalTimeOff,
  professionals,
} from '@/lib/db/schema';
import { postSystemEvent } from '@/lib/messaging/bot';
import { getPatientPerson } from '@/lib/patients/persons';
import { localDateKey, localParts } from '@/lib/tasks/tz';
import { relativeDayLabel } from '@/lib/whatsapp/agent/slot-mention';

/**
 * Cuando se libera un hueco, se le ofrece PRIMERO a las familias que marcaron
 * "quiere adelantar" (↑ en el calendario) con el mismo profesional y cita
 * posterior, de una en una y por orden de cita. Mientras contestan, el hueco
 * queda reservado con un bloqueo para que nadie lo coja. Si dicen que no o no
 * contestan en el plazo, pasa a la siguiente; cuando no queda nadie, el hueco
 * sigue el camino de siempre (lista de espera).
 */

export const HOLD_REASON = 'Hueco reservado: ofrecido a una familia que quería adelantar';
const HOLD_MS = 2 * 3_600_000;
const MIN_LEAD_MS = 45 * 60_000;

export interface FreedSlot {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  /** La cita que dejó el hueco, si fue una cancelación. */
  freedAppointmentId?: string | null;
  cancelledSlotId?: string | null;
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
  const expiresAt = new Date(
    Math.min(now.getTime() + HOLD_MS, slot.startsAt.getTime() - 30 * 60_000),
  );
  if (expiresAt.getTime() - now.getTime() < 10 * 60_000) return false;

  // Ya ofrecido para este hueco a alguien que dijo que no (o no contestó).
  const already = await db
    .select({ appointmentId: advanceOffers.appointmentId, status: advanceOffers.status })
    .from(advanceOffers)
    .where(
      and(
        eq(advanceOffers.tenantId, tenantId),
        eq(advanceOffers.professionalId, slot.professionalId),
        eq(advanceOffers.slotStartsAt, slot.startsAt),
      ),
    );
  if (already.some((o) => o.status === 'SENT')) return true;
  const skip = new Set(already.map((o) => o.appointmentId));

  const candidates = await db
    .select()
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        eq(agendaAppointments.professionalId, slot.professionalId),
        inArray(agendaAppointments.status, ['SCHEDULED', 'CONFIRMED']),
        eq(agendaAppointments.advancePreference, 'ACCEPTS'),
        isNotNull(agendaAppointments.patientPhone),
        gt(agendaAppointments.startsAt, slot.endsAt),
        ...(slot.freedAppointmentId ? [ne(agendaAppointments.id, slot.freedAppointmentId)] : []),
        ...(skip.size ? [notInArray(agendaAppointments.id, [...skip])] : []),
      ),
    )
    .orderBy(agendaAppointments.startsAt);
  const pendingIds = new Set(
    (
      await db
        .select({ appointmentId: advanceOffers.appointmentId })
        .from(advanceOffers)
        .where(and(eq(advanceOffers.tenantId, tenantId), eq(advanceOffers.status, 'SENT')))
    ).map((o) => o.appointmentId),
  );
  const target = candidates.find(
    (c) =>
      !pendingIds.has(c.id) &&
      c.endsAt.getTime() - c.startsAt.getTime() <= slotMs &&
      c.patientPhone,
  );
  if (!target || !target.patientPhone) return false;

  const [professional] = await db
    .select({ name: professionals.fullName })
    .from(professionals)
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, slot.professionalId)))
    .limit(1);
  const [tenant, tz, person] = await Promise.all([
    getTenant(tenantId),
    tenantTimezone(tenantId),
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
  const text =
    `${hello}, soy el asistente virtual de la agenda de ${clinic}. ` +
    `Se ha liberado un hueco ${hueco.day} a las ${hueco.time}${professional ? ` con ${professional.name}` : ''}. ` +
    `Nos dijisteis que queríais adelantar la cita de ${patientName} del ${cita.day} a las ${cita.time}. ¿Os la cambiamos a ese hueco?`;
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
): Promise<string[]> {
  const tz = await tenantTimezone(row.tenantId);
  const todayKey = localDateKey(new Date(), tz);
  if (answer === 'no') {
    await closeOffer(row.id, 'DECLINED');
    await passToNext(row);
    return ['Vale, dejamos la cita como estaba. ¡Gracias por contestar!'];
  }
  const closed = await closeOffer(row.id, 'ACCEPTED');
  if (!closed) return [];
  const [before] = await db
    .select({
      startsAt: agendaAppointments.startsAt,
      endsAt: agendaAppointments.endsAt,
      patientName: agendaAppointments.patientName,
    })
    .from(agendaAppointments)
    .where(
      and(
        eq(agendaAppointments.tenantId, row.tenantId),
        eq(agendaAppointments.id, row.appointmentId),
      ),
    )
    .limit(1);
  try {
    await rescheduleAppointment(systemAgendaContext(row.tenantId), row.appointmentId, {
      startsAt: row.slotStartsAt.toISOString(),
      allowOutsideHours: true,
    });
  } catch (err) {
    console.warn('[adelanto] no se pudo mover la cita', (err as Error).message);
    await db.update(advanceOffers).set({ status: 'CANCELLED' }).where(eq(advanceOffers.id, row.id));
    return [
      'Lo sentimos, ese hueco acaba de ocuparse. Vuestra cita sigue como estaba y os avisaremos si se libera otro.',
    ];
  }
  const when = describe(row.slotStartsAt, tz, todayKey);
  await postSystemEvent({
    tenantId: row.tenantId,
    event: 'waitlist.slot_open',
    title: `Cita adelantada — ${when.day} ${when.time}`,
    body: `${before?.patientName ?? 'La familia'} aceptó el hueco y su cita se movió.`,
    dedupeKey: `adv:accepted:${row.id}`,
  }).catch(() => undefined);
  // El hueco que deja la cita movida se ofrece al siguiente que quería adelantar.
  if (before) {
    await offerFreedSlot(row.tenantId, {
      professionalId: row.professionalId,
      startsAt: before.startsAt,
      endsAt: before.endsAt,
      freedAppointmentId: row.appointmentId,
    }).catch(() => false);
  }
  return [`¡Hecho! La cita queda ${when.day} a las ${when.time}. Os esperamos.`];
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
  const messages = await resolveOffer(row, m[1] === 'yes' ? 'yes' : 'no');
  if (messages.length)
    await sendClinicWhatsapp(args.tenantId, args.contactPhoneE164, messages).catch(() => false);
  return true;
}

/** Respuesta escrita ("1", "sí", "no"…) de la familia a una oferta pendiente. */
export async function handleAdvanceTextReply(args: {
  tenantId: string;
  contactPhoneE164: string;
  text: string | null | undefined;
}): Promise<boolean> {
  const row = await pendingOfferFor(args.tenantId, args.contactPhoneE164);
  if (!row) return false;
  const answer = parseAdvanceReply(args.text);
  if (!answer) return false;
  const messages = await resolveOffer(row, answer);
  if (messages.length)
    await sendClinicWhatsapp(args.tenantId, args.contactPhoneE164, messages).catch(() => false);
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
