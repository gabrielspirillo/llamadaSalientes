import 'server-only';
import { db } from '@/lib/db/client';
import {
  calls,
  cancelledSlots,
  outboundTargets,
  schedulingOffers,
  treatments,
  whatsappContacts,
  whatsappConversations,
} from '@/lib/db/schema';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Slot-fill attribution
//
// El sistema gana revenue cuando una cita CANCELADA por un paciente A es
// llenada por un paciente B contactado proactivamente por outbound, inbound
// o whatsapp. Este módulo:
//
//   1. Registra la cancelación (recordCancelledSlot)
//   2. Cuando llega una NUEVA cita, busca un cancelled_slot pendiente que
//      ocupe el mismo (calendar_id, start_time), determina el canal que
//      contactó al nuevo paciente, y crea un scheduling_offer con el
//      revenue snapshot (tryAttributeNewAppointment).
// ─────────────────────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_ATTRIBUTION_WINDOWS = {
  outboundHours: 72,
  whatsappHours: 48,
  inboundHours: 24,
} as const;

export type AttributionWindows = typeof DEFAULT_ATTRIBUTION_WINDOWS;

export type CancelledSlotInput = {
  tenantId: string;
  ghlAppointmentId: string;
  calendarId?: string | null;
  treatmentId?: string | null;
  ghlContactId?: string | null;
  startTime: Date;
  endTime?: Date | null;
  cancelledAt?: Date;
};

export type NewAppointmentInput = {
  tenantId: string;
  ghlAppointmentId: string;
  calendarId: string | null;
  treatmentId?: string | null;
  ghlContactId: string | null;
  startTime: Date;
  endTime?: Date | null;
  createdAt?: Date;
};

export type AttributionCandidate = {
  source: 'outbound' | 'inbound' | 'whatsapp';
  timestamp: Date;
  triggerCallId?: string | null;
  triggerCampaignId?: string | null;
  triggerWhatsappConversationId?: string | null;
};

export type SlotAttributionResult = {
  scheduledOfferId: string;
  cancelledSlotId: string;
  source: AttributionCandidate['source'];
  estimatedRevenueCents: number;
};

/**
 * Registra una cita cancelada como slot pendiente. Idempotente: dos llamadas
 * con el mismo ghlAppointmentId no duplican rows.
 */
export async function recordCancelledSlot(input: CancelledSlotInput): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(cancelledSlots)
    .values({
      tenantId: input.tenantId,
      ghlAppointmentId: input.ghlAppointmentId,
      calendarId: input.calendarId ?? null,
      treatmentId: input.treatmentId ?? null,
      ghlContactId: input.ghlContactId ?? null,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
      cancelledAt: input.cancelledAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [cancelledSlots.tenantId, cancelledSlots.ghlAppointmentId],
    })
    .returning({ id: cancelledSlots.id });

  if (inserted) return inserted;

  const [existing] = await db
    .select({ id: cancelledSlots.id })
    .from(cancelledSlots)
    .where(
      and(
        eq(cancelledSlots.tenantId, input.tenantId),
        eq(cancelledSlots.ghlAppointmentId, input.ghlAppointmentId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error('recordCancelledSlot: conflicto sin row existente');
  }
  return existing;
}

/**
 * Busca un cancelled_slot pendiente que coincida con la nueva cita por
 * (tenant_id, calendar_id, start_time exacto). Devuelve el más reciente.
 */
async function findMatchingCancelledSlot(input: NewAppointmentInput) {
  if (!input.calendarId) return null;

  const [match] = await db
    .select({
      id: cancelledSlots.id,
      treatmentId: cancelledSlots.treatmentId,
    })
    .from(cancelledSlots)
    .where(
      and(
        eq(cancelledSlots.tenantId, input.tenantId),
        eq(cancelledSlots.calendarId, input.calendarId),
        eq(cancelledSlots.startTime, input.startTime),
        isNull(cancelledSlots.recoveredAt),
      ),
    )
    .orderBy(desc(cancelledSlots.cancelledAt))
    .limit(1);

  return match ?? null;
}

async function findOutboundCandidate(
  tenantId: string,
  ghlContactId: string,
  since: Date,
): Promise<AttributionCandidate | null> {
  const [row] = await db
    .select({
      callId: calls.id,
      campaignId: outboundTargets.campaignId,
      lastAttemptAt: outboundTargets.lastAttemptAt,
    })
    .from(outboundTargets)
    .leftJoin(calls, eq(calls.retellCallId, outboundTargets.retellCallId))
    .where(
      and(
        eq(outboundTargets.tenantId, tenantId),
        eq(outboundTargets.ghlContactId, ghlContactId),
        eq(outboundTargets.status, 'ended'),
        gte(outboundTargets.lastAttemptAt, since),
      ),
    )
    .orderBy(desc(outboundTargets.lastAttemptAt))
    .limit(1);

  if (!row?.lastAttemptAt) return null;
  return {
    source: 'outbound',
    timestamp: row.lastAttemptAt,
    triggerCallId: row.callId ?? null,
    triggerCampaignId: row.campaignId ?? null,
  };
}

async function findWhatsappCandidate(
  tenantId: string,
  ghlContactId: string,
  since: Date,
): Promise<AttributionCandidate | null> {
  const [row] = await db
    .select({
      conversationId: whatsappConversations.id,
      lastMsgAt: whatsappConversations.lastMsgAt,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.contactId))
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        eq(whatsappContacts.ghlContactId, ghlContactId),
        gte(whatsappConversations.lastMsgAt, since),
      ),
    )
    .orderBy(desc(whatsappConversations.lastMsgAt))
    .limit(1);

  if (!row?.lastMsgAt) return null;
  return {
    source: 'whatsapp',
    timestamp: row.lastMsgAt,
    triggerWhatsappConversationId: row.conversationId,
  };
}

async function findInboundCandidate(
  tenantId: string,
  ghlContactId: string,
  since: Date,
): Promise<AttributionCandidate | null> {
  // Una llamada se considera "inbound" si NO está enlazada a un outbound_target.
  const [row] = await db
    .select({
      callId: calls.id,
      startedAt: calls.startedAt,
    })
    .from(calls)
    .leftJoin(outboundTargets, eq(outboundTargets.retellCallId, calls.retellCallId))
    .where(
      and(
        eq(calls.tenantId, tenantId),
        eq(calls.ghlContactId, ghlContactId),
        eq(calls.intent, 'agendar'),
        gte(calls.startedAt, since),
        isNull(outboundTargets.id),
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(1);

  if (!row?.startedAt) return null;
  return {
    source: 'inbound',
    timestamp: row.startedAt,
    triggerCallId: row.callId,
  };
}

const SOURCE_PRIORITY: Record<AttributionCandidate['source'], number> = {
  outbound: 3,
  whatsapp: 2,
  inbound: 1,
};

/**
 * Selecciona el candidato más cercano al `appointmentCreatedAt`. Empate
 * temporal se rompe por prioridad: outbound > whatsapp > inbound (canal
 * más explícitamente proactivo gana).
 */
export function pickBestAttribution(
  candidates: AttributionCandidate[],
  appointmentCreatedAt: Date,
): AttributionCandidate | null {
  if (candidates.length === 0) return null;

  const reference = appointmentCreatedAt.getTime();
  return candidates.reduce<AttributionCandidate | null>((best, c) => {
    if (!best) return c;
    const dBest = Math.abs(reference - best.timestamp.getTime());
    const dCurrent = Math.abs(reference - c.timestamp.getTime());
    if (dCurrent < dBest) return c;
    if (dCurrent > dBest) return best;
    return SOURCE_PRIORITY[c.source] > SOURCE_PRIORITY[best.source] ? c : best;
  }, null);
}

async function resolveAttribution(
  input: NewAppointmentInput,
  windows: AttributionWindows,
): Promise<AttributionCandidate | null> {
  if (!input.ghlContactId) return null;
  const ref = input.createdAt ?? new Date();

  const [outbound, whatsapp, inbound] = await Promise.all([
    findOutboundCandidate(
      input.tenantId,
      input.ghlContactId,
      new Date(ref.getTime() - windows.outboundHours * HOUR_MS),
    ),
    findWhatsappCandidate(
      input.tenantId,
      input.ghlContactId,
      new Date(ref.getTime() - windows.whatsappHours * HOUR_MS),
    ),
    findInboundCandidate(
      input.tenantId,
      input.ghlContactId,
      new Date(ref.getTime() - windows.inboundHours * HOUR_MS),
    ),
  ]);

  const candidates = [outbound, whatsapp, inbound].filter(
    (c): c is AttributionCandidate => c !== null,
  );
  return pickBestAttribution(candidates, ref);
}

async function lookupRevenueCents(
  tenantId: string,
  treatmentId: string | null | undefined,
): Promise<{ priceCents: number; currency: string }> {
  if (!treatmentId) return { priceCents: 0, currency: 'EUR' };
  const [t] = await db
    .select({ priceCents: treatments.priceCents, currency: treatments.currency })
    .from(treatments)
    .where(and(eq(treatments.tenantId, tenantId), eq(treatments.id, treatmentId)))
    .limit(1);
  return {
    priceCents: t?.priceCents ?? 0,
    currency: t?.currency ?? 'EUR',
  };
}

/**
 * Procesa una cita recién creada en GHL. Si rellena un cancelled_slot
 * pendiente y se puede atribuir a un canal, crea un scheduling_offer y
 * marca el slot como recuperado. Idempotente sobre ghl_appointment_id.
 */
export async function tryAttributeNewAppointment(
  input: NewAppointmentInput,
  windows: AttributionWindows = DEFAULT_ATTRIBUTION_WINDOWS,
): Promise<SlotAttributionResult | null> {
  const slot = await findMatchingCancelledSlot(input);
  if (!slot) return null;

  const attribution = await resolveAttribution(input, windows);
  if (!attribution) return null;

  const treatmentId = input.treatmentId ?? slot.treatmentId ?? null;
  const { priceCents, currency } = await lookupRevenueCents(input.tenantId, treatmentId);

  const [offer] = await db
    .insert(schedulingOffers)
    .values({
      tenantId: input.tenantId,
      cancelledSlotId: slot.id,
      source: attribution.source,
      triggerCallId: attribution.triggerCallId ?? null,
      triggerWhatsappConversationId: attribution.triggerWhatsappConversationId ?? null,
      triggerCampaignId: attribution.triggerCampaignId ?? null,
      treatmentId,
      ghlAppointmentId: input.ghlAppointmentId,
      acceptedAt: input.createdAt ?? new Date(),
      estimatedRevenueCents: priceCents,
      currency,
    })
    .onConflictDoNothing({
      target: [schedulingOffers.tenantId, schedulingOffers.ghlAppointmentId],
    })
    .returning({ id: schedulingOffers.id });

  // Si el offer ya existía (idempotencia), no volver a marcar el slot.
  if (!offer) return null;

  await db
    .update(cancelledSlots)
    .set({ recoveredAt: sql`now()` })
    .where(eq(cancelledSlots.id, slot.id));

  return {
    scheduledOfferId: offer.id,
    cancelledSlotId: slot.id,
    source: attribution.source,
    estimatedRevenueCents: priceCents,
  };
}
