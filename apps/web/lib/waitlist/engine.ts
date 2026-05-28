import 'server-only';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  appointmentsCache,
  cancelledSlots,
  clinicSettings,
  patientsCache,
  treatments,
  waitlistEntries,
  waitlistOffers,
  waitlistSettings as waitlistSettingsTable,
} from '@/lib/db/schema';
import { sendQueueEvent } from '@/lib/queue/client';
import { getOrCreateWaitlistSettings, type WaitlistSettingsRow } from '@/lib/waitlist/settings';
import {
  evaluateMatch,
  type MatchSettings,
  type SlotForMatching,
  type WaitlistEntryForMatching,
} from '@/lib/waitlist/match-rules';
import { computeTtl } from '@/lib/waitlist/ttl';
import { buildWaitlistVars } from '@/lib/waitlist/variables';
import type { WaitlistChannel, WaitlistDriverScope } from '@/lib/waitlist/types';
import { driverScopeForWhatsAppMode } from '@/lib/reminders/template-resolver';
import { resolveActiveConnection } from '@/lib/reminders/send-whatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// Engine de waitlist.
//
// Punto de entrada principal: enqueueOfferForCancelledSlot(tenantId, slotId).
// Llamado desde el webhook GHL cuando se registra un cancelled_slot.
//
// Idempotente: si el slot ya tiene una oferta ACTIVA (PENDING/SENT) no hace
// nada. Si la última oferta fue ACEPTADA, tampoco (slot ya recuperado).
// ─────────────────────────────────────────────────────────────────────────────

export type EnqueueResult =
  | { ok: true; offerId: string; channel: WaitlistChannel; expiresAt: Date }
  | { ok: false; reason: string };

const ACTIVE_OFFER_STATUSES = ['PENDING', 'SENT'] as const;

export async function enqueueOfferForCancelledSlot(
  tenantId: string,
  cancelledSlotId: string,
): Promise<EnqueueResult> {
  const settings = await getOrCreateWaitlistSettings(tenantId);
  if (!settings.enabled) return { ok: false, reason: 'waitlist_disabled' };

  const [slot] = await db
    .select()
    .from(cancelledSlots)
    .where(and(eq(cancelledSlots.tenantId, tenantId), eq(cancelledSlots.id, cancelledSlotId)))
    .limit(1);
  if (!slot) return { ok: false, reason: 'slot_not_found' };
  if (slot.recoveredAt) return { ok: false, reason: 'slot_already_recovered' };

  // Si ya hay oferta ACTIVA o ACEPTADA para este slot, no encolar.
  const existing = await db
    .select({ id: waitlistOffers.id, status: waitlistOffers.status })
    .from(waitlistOffers)
    .where(
      and(
        eq(waitlistOffers.tenantId, tenantId),
        eq(waitlistOffers.cancelledSlotId, cancelledSlotId),
        inArray(waitlistOffers.status, ['PENDING', 'SENT', 'ACCEPTED']),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    const e = existing[0]!;
    return { ok: false, reason: `slot_has_active_offer_${e.status.toLowerCase()}` };
  }

  // TTL: skip si está muy cerca.
  const ttl = computeTtl(slot.startTime, settings);
  if (ttl.shouldSkip) return { ok: false, reason: ttl.reason };

  // Resolver duración + dentista del slot a partir del tratamiento + cita original.
  const [tx] = slot.treatmentId
    ? await db
        .select({
          durationMinutes: treatments.durationMinutes,
          waitlistEligible: treatments.waitlistEligible,
        })
        .from(treatments)
        .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, slot.treatmentId)))
        .limit(1)
    : [];
  if (!tx) return { ok: false, reason: 'treatment_not_found' };
  if (!tx.waitlistEligible) return { ok: false, reason: 'treatment_not_eligible' };

  // Slot dentista: en GHL la asignación del dentista a la cita original quedó en
  // appointmentsCache si la cancelación llegó vía webhook. Buscamos por appt id.
  const [originalAppt] = await db
    .select({ assignedUserId: appointmentsCache.assignedUserId })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        eq(appointmentsCache.ghlAppointmentId, slot.ghlAppointmentId),
      ),
    )
    .limit(1);

  const slotForMatching: SlotForMatching = {
    treatmentId: slot.treatmentId,
    assignedDentistId: originalAppt?.assignedUserId ?? null,
    startTime: slot.startTime,
    endTime: slot.endTime,
    treatmentDurationMinutes: tx.durationMinutes,
  };

  // Cargar config de clínica para TZ.
  const [clinic] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  const tz = clinic?.timezone ?? 'Europe/Madrid';

  const matchSettings: MatchSettings = {
    minAdvanceDays: settings.minAdvanceDays,
    requireSameDentist: settings.requireSameDentist,
    respectTimeWindow: settings.respectTimeWindow,
    clinicTimezone: tz,
  };

  const entry = await findNextEligibleEntry(tenantId, slotForMatching, matchSettings);
  if (!entry) return { ok: false, reason: 'no_eligible_entry' };

  // Determinar canal según channel_mode.
  const channel = pickInitialChannel(settings.channelMode);
  const driverScope = await resolveDriverScope(tenantId, channel);
  if (!driverScope) return { ok: false, reason: 'no_driver_for_channel' };

  // Insertar oferta y encolar job. INSERT puede fallar por index parcial único
  // (entry ya tiene oferta activa para OTRO slot) — en ese caso buscar al siguiente.
  const offerInsertion = await tryInsertOffer({
    tenantId,
    waitlistEntryId: entry.id,
    cancelledSlotId,
    channel,
    driverScope,
    expiresAt: ttl.expiresAt,
    payload: {
      slotStartTime: slot.startTime.toISOString(),
      ttlMinutes: ttl.ttlMinutes,
    },
  });
  if (!offerInsertion.ok) {
    // Llamada recursiva: probar siguiente paciente. Skipeo este entry.
    return enqueueOfferForCancelledSlotExcluding(tenantId, cancelledSlotId, [entry.id]);
  }

  await sendQueueEvent('waitlist-offer-send', {
    tenantId,
    offerId: offerInsertion.offerId,
  });

  return {
    ok: true,
    offerId: offerInsertion.offerId,
    channel,
    expiresAt: ttl.expiresAt,
  };
}

// Variante con exclusión, para reintentar al siguiente en cola cuando el primer
// match estaba bloqueado por una oferta activa para otro slot.
async function enqueueOfferForCancelledSlotExcluding(
  tenantId: string,
  cancelledSlotId: string,
  excludeEntryIds: string[],
): Promise<EnqueueResult> {
  // Para no duplicar lógica, hacemos otra ronda. En la mayoría de casos hay un
  // solo paciente que choca; raras veces hay más de 2-3.
  const settings = await getOrCreateWaitlistSettings(tenantId);
  const [slot] = await db
    .select()
    .from(cancelledSlots)
    .where(eq(cancelledSlots.id, cancelledSlotId))
    .limit(1);
  if (!slot) return { ok: false, reason: 'slot_not_found' };

  const ttl = computeTtl(slot.startTime, settings);
  if (ttl.shouldSkip) return { ok: false, reason: ttl.reason };

  const [tx] = slot.treatmentId
    ? await db
        .select({ durationMinutes: treatments.durationMinutes })
        .from(treatments)
        .where(eq(treatments.id, slot.treatmentId))
        .limit(1)
    : [];
  if (!tx) return { ok: false, reason: 'treatment_not_found' };

  const [originalAppt] = await db
    .select({ assignedUserId: appointmentsCache.assignedUserId })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        eq(appointmentsCache.ghlAppointmentId, slot.ghlAppointmentId),
      ),
    )
    .limit(1);

  const [clinic] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);

  const matchSettings: MatchSettings = {
    minAdvanceDays: settings.minAdvanceDays,
    requireSameDentist: settings.requireSameDentist,
    respectTimeWindow: settings.respectTimeWindow,
    clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
  };

  const slotForMatching: SlotForMatching = {
    treatmentId: slot.treatmentId,
    assignedDentistId: originalAppt?.assignedUserId ?? null,
    startTime: slot.startTime,
    endTime: slot.endTime,
    treatmentDurationMinutes: tx.durationMinutes,
  };

  const entry = await findNextEligibleEntry(
    tenantId,
    slotForMatching,
    matchSettings,
    excludeEntryIds,
  );
  if (!entry) return { ok: false, reason: 'no_eligible_entry' };

  const channel = pickInitialChannel(settings.channelMode);
  const driverScope = await resolveDriverScope(tenantId, channel);
  if (!driverScope) return { ok: false, reason: 'no_driver_for_channel' };

  const inserted = await tryInsertOffer({
    tenantId,
    waitlistEntryId: entry.id,
    cancelledSlotId,
    channel,
    driverScope,
    expiresAt: ttl.expiresAt,
    payload: { slotStartTime: slot.startTime.toISOString(), ttlMinutes: ttl.ttlMinutes },
  });
  if (!inserted.ok) {
    return enqueueOfferForCancelledSlotExcluding(tenantId, cancelledSlotId, [
      ...excludeEntryIds,
      entry.id,
    ]);
  }

  await sendQueueEvent('waitlist-offer-send', { tenantId, offerId: inserted.offerId });
  return { ok: true, offerId: inserted.offerId, channel, expiresAt: ttl.expiresAt };
}

async function tryInsertOffer(args: {
  tenantId: string;
  waitlistEntryId: string;
  cancelledSlotId: string;
  channel: WaitlistChannel;
  driverScope: WaitlistDriverScope;
  expiresAt: Date;
  payload: Record<string, unknown>;
}): Promise<{ ok: true; offerId: string } | { ok: false; reason: string }> {
  try {
    const [row] = await db
      .insert(waitlistOffers)
      .values({
        tenantId: args.tenantId,
        waitlistEntryId: args.waitlistEntryId,
        cancelledSlotId: args.cancelledSlotId,
        channel: args.channel,
        driverScope: args.driverScope,
        status: 'PENDING',
        expiresAt: args.expiresAt,
        payloadSnapshot: args.payload,
      })
      .returning({ id: waitlistOffers.id });
    if (!row) return { ok: false, reason: 'insert_returned_empty' };
    return { ok: true, offerId: row.id };
  } catch (err) {
    // 23505 = unique violation. Probable colisión con índice parcial
    // (waitlist_offers_entry_active_unique).
    const code = (err as { code?: string })?.code;
    if (code === '23505') return { ok: false, reason: 'entry_has_active_offer' };
    throw err;
  }
}

export async function findNextEligibleEntry(
  tenantId: string,
  slot: SlotForMatching,
  settings: MatchSettings,
  excludeEntryIds: string[] = [],
): Promise<{ id: string } | null> {
  // FIFO por createdAt ASC. Pre-filtros en SQL: tenant + ACTIVE + treatment.
  // Filtros que necesitan datos del entry (window, dentista) los aplicamos en JS
  // sobre el lote inicial; en la práctica son pocas filas.
  if (!slot.treatmentId) return null;

  const candidates = await db
    .select({
      id: waitlistEntries.id,
      treatmentId: waitlistEntries.treatmentId,
      assignedDentistId: waitlistEntries.assignedDentistId,
      originalStartTime: waitlistEntries.originalStartTime,
      preferredTimeWindowStart: waitlistEntries.preferredTimeWindowStart,
      preferredTimeWindowEnd: waitlistEntries.preferredTimeWindowEnd,
    })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.tenantId, tenantId),
        eq(waitlistEntries.status, 'ACTIVE'),
        eq(waitlistEntries.treatmentId, slot.treatmentId),
        excludeEntryIds.length > 0
          ? sql`${waitlistEntries.id} NOT IN ${excludeEntryIds}`
          : sql`true`,
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt))
    .limit(50);

  for (const c of candidates) {
    const entry: WaitlistEntryForMatching = {
      treatmentId: c.treatmentId,
      assignedDentistId: c.assignedDentistId,
      originalStartTime: c.originalStartTime,
      preferredTimeWindowStart: c.preferredTimeWindowStart,
      preferredTimeWindowEnd: c.preferredTimeWindowEnd,
    };
    const decision = evaluateMatch(entry, slot, settings);
    if (decision.eligible) {
      // Verificar que no tiene oferta activa para OTRO slot. Si tiene, saltarlo.
      const blocked = await db
        .select({ id: waitlistOffers.id })
        .from(waitlistOffers)
        .where(
          and(
            eq(waitlistOffers.waitlistEntryId, c.id),
            inArray(waitlistOffers.status, ['PENDING', 'SENT']),
          ),
        )
        .limit(1);
      if (blocked.length > 0) continue;
      return { id: c.id };
    }
  }
  return null;
}

function pickInitialChannel(mode: WaitlistSettingsRow['channelMode']): WaitlistChannel {
  if (mode === 'VOICE_ONLY') return 'VOICE';
  return 'WHATSAPP'; // WHATSAPP_ONLY o WHATSAPP_THEN_VOICE empiezan por WA
}

async function resolveDriverScope(
  tenantId: string,
  channel: WaitlistChannel,
): Promise<WaitlistDriverScope | null> {
  if (channel === 'VOICE') return 'voice_retell';
  const conn = await resolveActiveConnection(tenantId);
  if (!conn) return null;
  return driverScopeForWhatsAppMode(conn.mode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expiración + avance al siguiente.
// ─────────────────────────────────────────────────────────────────────────────

export async function expireOfferAndAdvance(offerId: string): Promise<EnqueueResult> {
  const [offer] = await db
    .select()
    .from(waitlistOffers)
    .where(eq(waitlistOffers.id, offerId))
    .limit(1);
  if (!offer) return { ok: false, reason: 'offer_not_found' };
  // Si ya respondió, no-op.
  if (offer.status !== 'PENDING' && offer.status !== 'SENT') {
    return { ok: false, reason: `already_${offer.status.toLowerCase()}` };
  }

  await db
    .update(waitlistOffers)
    .set({ status: 'EXPIRED', updatedAt: new Date() })
    .where(eq(waitlistOffers.id, offerId));

  // Si el tenant es WHATSAPP_THEN_VOICE y ésta fue una WHATSAPP, crear una
  // VOICE para la MISMA entry antes de pasar al siguiente.
  const settings = await getOrCreateWaitlistSettings(offer.tenantId);
  if (settings.channelMode === 'WHATSAPP_THEN_VOICE' && offer.channel === 'WHATSAPP') {
    const voiceTtl = computeTtl(
      new Date(
        (offer.payloadSnapshot as { slotStartTime?: string })?.slotStartTime ?? Date.now(),
      ),
      settings,
    );
    if (!voiceTtl.shouldSkip) {
      const driverScope: WaitlistDriverScope = 'voice_retell';
      const inserted = await tryInsertOffer({
        tenantId: offer.tenantId,
        waitlistEntryId: offer.waitlistEntryId,
        cancelledSlotId: offer.cancelledSlotId,
        channel: 'VOICE',
        driverScope,
        expiresAt: voiceTtl.expiresAt,
        payload: { ...(offer.payloadSnapshot as Record<string, unknown>), fallbackFrom: offer.id },
      });
      if (inserted.ok) {
        await db
          .update(waitlistOffers)
          .set({ previousOfferId: offer.id })
          .where(eq(waitlistOffers.id, inserted.offerId));
        await sendQueueEvent('waitlist-offer-send', {
          tenantId: offer.tenantId,
          offerId: inserted.offerId,
        });
        return {
          ok: true,
          offerId: inserted.offerId,
          channel: 'VOICE',
          expiresAt: voiceTtl.expiresAt,
        };
      }
    }
  }

  // Pasar al siguiente en cola para el mismo cancelled_slot, excluyendo al
  // que acaba de expirar (no le vamos a re-ofertar el mismo slot ahora mismo).
  return enqueueOfferForCancelledSlotExcluding(offer.tenantId, offer.cancelledSlotId, [
    offer.waitlistEntryId,
  ]);
}

export async function markOfferDeclined(args: {
  offerId: string;
  via: 'button' | 'text' | 'voice_tool' | 'manual';
}): Promise<EnqueueResult> {
  const [offer] = await db
    .select()
    .from(waitlistOffers)
    .where(eq(waitlistOffers.id, args.offerId))
    .limit(1);
  if (!offer) return { ok: false, reason: 'offer_not_found' };
  if (offer.status !== 'PENDING' && offer.status !== 'SENT') {
    return { ok: false, reason: `already_${offer.status.toLowerCase()}` };
  }
  await db
    .update(waitlistOffers)
    .set({
      status: 'DECLINED',
      respondedAt: new Date(),
      responseVia: args.via,
      updatedAt: new Date(),
    })
    .where(eq(waitlistOffers.id, args.offerId));
  // Avanzar al siguiente en cola (sin reintentar al que acaba de rechazar).
  return enqueueOfferForCancelledSlotExcluding(offer.tenantId, offer.cancelledSlotId, [
    offer.waitlistEntryId,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aceptación: agenda nueva cita en GHL + cancela vieja (cascada).
// La cancelación dispara webhook GHL → recordCancelledSlot + enqueueOffer.
// Si la cita vieja calza con el siguiente paciente de la cola, se ofrece sola.
// ─────────────────────────────────────────────────────────────────────────────

export async function markOfferAccepted(args: {
  offerId: string;
  via: 'button' | 'text' | 'voice_tool' | 'manual';
}): Promise<
  | { ok: true; newAppointmentId: string; oldAppointmentId: string }
  | { ok: false; reason: string }
> {
  const [offer] = await db
    .select()
    .from(waitlistOffers)
    .where(eq(waitlistOffers.id, args.offerId))
    .limit(1);
  if (!offer) return { ok: false, reason: 'offer_not_found' };
  if (offer.status !== 'PENDING' && offer.status !== 'SENT') {
    return { ok: false, reason: `already_${offer.status.toLowerCase()}` };
  }

  // Datos del slot + entry para hacer book + cancel.
  const [slot] = await db
    .select()
    .from(cancelledSlots)
    .where(eq(cancelledSlots.id, offer.cancelledSlotId))
    .limit(1);
  if (!slot) return { ok: false, reason: 'slot_not_found' };

  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, offer.waitlistEntryId))
    .limit(1);
  if (!entry) return { ok: false, reason: 'entry_not_found' };

  const [tx] = entry.treatmentId
    ? await db
        .select({ name: treatments.name })
        .from(treatments)
        .where(eq(treatments.id, entry.treatmentId))
        .limit(1)
    : [];

  // Import lazy para evitar ciclo (retell/tools toca calls que tocan workers).
  const { bookAppointment, cancelAppointment } = await import('@/lib/retell/tools');

  const bookRes = await bookAppointment(offer.tenantId, {
    contact_id: entry.ghlContactId,
    calendar_id: slot.calendarId ?? '',
    start_time: slot.startTime.toISOString(),
    treatment_name: tx?.name ?? 'cita',
  });
  // bookAppointment devuelve un texto humano — éxito implícito si no contiene
  // "no puedo" / "error". Para una señal exacta lo ideal sería refactorizarla;
  // por ahora, asumimos OK si no contiene marca de error.
  const lowered = bookRes.result.toLowerCase();
  if (lowered.includes('no puedo') || lowered.includes('error') || lowered.includes('inválido')) {
    await db
      .update(waitlistOffers)
      .set({ errorMessage: `book_failed: ${bookRes.result}`, updatedAt: new Date() })
      .where(eq(waitlistOffers.id, args.offerId));
    return { ok: false, reason: 'book_failed' };
  }

  // Cancelar cita vieja en GHL — el webhook GHL hará el cascade.
  await cancelAppointment(offer.tenantId, { appointment_id: entry.ghlAppointmentId }).catch(
    (err) => console.error('[waitlist] cancel old appt failed', err),
  );

  // Marcar la oferta como aceptada y la entry como fulfilled.
  await db
    .update(waitlistOffers)
    .set({
      status: 'ACCEPTED',
      respondedAt: new Date(),
      responseVia: args.via,
      updatedAt: new Date(),
    })
    .where(eq(waitlistOffers.id, args.offerId));
  await db
    .update(waitlistEntries)
    .set({ status: 'FULFILLED', fulfilledAt: new Date(), updatedAt: new Date() })
    .where(eq(waitlistEntries.id, entry.id));

  // Marcar el slot como recuperado (el webhook also hace esto vía scheduling_offers,
  // pero queremos cierre limpio aunque el webhook tarde).
  await db
    .update(cancelledSlots)
    .set({ recoveredAt: sql`now()` })
    .where(eq(cancelledSlots.id, slot.id));

  // Otras ofertas vivas para el mismo slot quedan SUPERSEDED.
  await db
    .update(waitlistOffers)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(
      and(
        eq(waitlistOffers.cancelledSlotId, slot.id),
        ne(waitlistOffers.id, args.offerId),
        inArray(waitlistOffers.status, ['PENDING', 'SENT']),
      ),
    );

  return {
    ok: true,
    newAppointmentId: 'pending-webhook', // GHL devuelve id pero bookAppointment no lo expone
    oldAppointmentId: entry.ghlAppointmentId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-enqueue al crearse una cita futura elegible.
// ─────────────────────────────────────────────────────────────────────────────

export async function autoEnqueueOnNewAppointment(input: {
  tenantId: string;
  ghlContactId: string | null;
  ghlAppointmentId: string;
  treatmentId: string | null;
  calendarId: string | null;
  assignedUserId: string | null;
  startTime: Date;
  endTime: Date | null;
}): Promise<{ ok: true; entryId: string } | { ok: false; reason: string }> {
  if (!input.ghlContactId) return { ok: false, reason: 'no_contact' };
  if (!input.treatmentId) return { ok: false, reason: 'no_treatment' };

  const settings = await getOrCreateWaitlistSettings(input.tenantId);
  if (!settings.enabled) return { ok: false, reason: 'waitlist_disabled' };

  const [tx] = await db
    .select({ waitlistEligible: treatments.waitlistEligible })
    .from(treatments)
    .where(
      and(eq(treatments.tenantId, input.tenantId), eq(treatments.id, input.treatmentId)),
    )
    .limit(1);
  if (!tx?.waitlistEligible) return { ok: false, reason: 'treatment_not_eligible' };

  // Umbral mínimo de lejanía.
  const daysAway = (input.startTime.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (daysAway < settings.minAppointmentDistanceDays) {
    return { ok: false, reason: 'appointment_too_close' };
  }
  // Tope máximo de lejanía (opcional). NULL = sin límite.
  if (
    settings.maxAppointmentDistanceDays != null &&
    daysAway > settings.maxAppointmentDistanceDays
  ) {
    return { ok: false, reason: 'appointment_too_far' };
  }

  const [row] = await db
    .insert(waitlistEntries)
    .values({
      tenantId: input.tenantId,
      ghlContactId: input.ghlContactId,
      ghlAppointmentId: input.ghlAppointmentId,
      treatmentId: input.treatmentId,
      calendarId: input.calendarId,
      assignedDentistId: input.assignedUserId,
      originalStartTime: input.startTime,
      originalEndTime: input.endTime,
      status: 'ACTIVE',
      source: 'auto',
    })
    .onConflictDoNothing({
      target: [waitlistEntries.tenantId, waitlistEntries.ghlAppointmentId],
    })
    .returning({ id: waitlistEntries.id });

  if (!row) return { ok: false, reason: 'already_exists' };
  return { ok: true, entryId: row.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Construye vars para el sender (whatsapp/voice).
// ─────────────────────────────────────────────────────────────────────────────

export async function buildVarsForOffer(offerId: string) {
  const [offer] = await db
    .select()
    .from(waitlistOffers)
    .where(eq(waitlistOffers.id, offerId))
    .limit(1);
  if (!offer) return null;

  const [entry] = await db
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, offer.waitlistEntryId))
    .limit(1);
  if (!entry) return null;

  const [slot] = await db
    .select()
    .from(cancelledSlots)
    .where(eq(cancelledSlots.id, offer.cancelledSlotId))
    .limit(1);
  if (!slot) return null;

  const [pt] = await db
    .select({
      firstName: patientsCache.firstName,
      lastName: patientsCache.lastName,
      phone: patientsCache.phone,
    })
    .from(patientsCache)
    .where(
      and(
        eq(patientsCache.tenantId, offer.tenantId),
        eq(patientsCache.ghlContactId, entry.ghlContactId),
      ),
    )
    .limit(1);

  const [tx] = entry.treatmentId
    ? await db
        .select({ name: treatments.name, durationMinutes: treatments.durationMinutes })
        .from(treatments)
        .where(eq(treatments.id, entry.treatmentId))
        .limit(1)
    : [];

  const [clinic] = await db
    .select({
      timezone: clinicSettings.timezone,
      address: clinicSettings.address,
      phones: clinicSettings.phones,
    })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, offer.tenantId))
    .limit(1);

  const vars = buildWaitlistVars({
    oldAppointmentStartTime: entry.originalStartTime,
    newSlotStartTime: slot.startTime,
    newSlotDurationMinutes: tx?.durationMinutes ?? null,
    treatmentName: tx?.name ?? null,
    contactFirstName: pt?.firstName ?? null,
    contactLastName: pt?.lastName ?? null,
    contactPhoneE164: pt?.phone ?? null,
    clinicName: '', // Se rellena por tenant.name si hace falta en sender
    clinicAddress: clinic?.address ?? null,
    clinicPhone: (clinic?.phones as string[] | null)?.[0] ?? null,
    clinicTimezone: clinic?.timezone ?? 'Europe/Madrid',
    offerId,
  });

  return { vars, offer, entry, slot, contactPhone: pt?.phone ?? null };
}

// `or` y `desc` están en el header para uso futuro de helpers de listing.
void or;
void desc;
