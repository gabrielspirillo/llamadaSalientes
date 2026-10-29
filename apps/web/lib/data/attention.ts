import 'server-only';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  appointmentDayOf,
  patients,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { contactDisplayNames } from '@/lib/patients/display-names';
import { patientFullName } from '@/lib/patients/persons';

export interface AttentionHandoff {
  conversationId: string;
  name: string;
  preview: string | null;
  since: Date;
  urgent: boolean;
}

export interface AttentionConfirmation {
  appointmentId: string;
  patientName: string;
  phone: string | null;
  startsAt: Date;
  callsDone: number;
}

export interface AttentionReview {
  patientId: string;
  name: string;
  reason: string | null;
}

export interface AttentionData {
  handoffs: AttentionHandoff[];
  confirmations: AttentionConfirmation[];
  reviews: AttentionReview[];
}

const LIMIT = 6;

/**
 * Lo que espera a una persona: chats derivados (o urgentes) que nadie del
 * equipo ha contestado, citas de hoy sin confirmar después del recordatorio y
 * pacientes con un aviso médico sin valorar. Cada bloque nunca rompe el
 * resto: si una consulta falla, ese bloque sale vacío.
 */
export async function getAttention(tenantId: string, now = new Date()): Promise<AttentionData> {
  const [handoffs, confirmations, reviews] = await Promise.all([
    loadHandoffs(tenantId).catch(() => []),
    loadConfirmations(tenantId, now).catch(() => []),
    loadReviews(tenantId).catch(() => []),
  ]);
  return { handoffs, confirmations, reviews };
}

async function loadHandoffs(tenantId: string): Promise<AttentionHandoff[]> {
  const rows = await db
    .select({
      id: whatsappConversations.id,
      contactId: whatsappConversations.contactId,
      urgent: whatsappConversations.urgentFlag,
      lastMsgAt: whatsappConversations.lastMsgAt,
      updatedAt: whatsappConversations.updatedAt,
    })
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, tenantId),
        or(
          eq(whatsappConversations.status, 'HANDOFF'),
          and(
            eq(whatsappConversations.urgentFlag, true),
            eq(whatsappConversations.status, 'ACTIVE'),
          ),
        ),
        // Esperando: nadie del equipo ha escrito después del último mensaje.
        or(
          isNull(whatsappConversations.lastHumanMsgAt),
          sql`${whatsappConversations.lastHumanMsgAt} < ${whatsappConversations.lastMsgAt}`,
        ),
      ),
    )
    .orderBy(desc(whatsappConversations.urgentFlag), desc(whatsappConversations.lastMsgAt))
    .limit(LIMIT);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [names, previews] = await Promise.all([
    contactDisplayNames(
      tenantId,
      rows.map((r) => r.contactId),
    ),
    db
      .selectDistinctOn([whatsappMessages.conversationId], {
        conversationId: whatsappMessages.conversationId,
        text: whatsappMessages.contentText,
      })
      .from(whatsappMessages)
      .where(
        and(
          eq(whatsappMessages.tenantId, tenantId),
          inArray(whatsappMessages.conversationId, ids),
          eq(whatsappMessages.direction, 'INBOUND'),
        ),
      )
      .orderBy(whatsappMessages.conversationId, desc(whatsappMessages.createdAt)),
  ]);
  const previewBy = new Map(previews.map((p) => [p.conversationId, p.text]));
  return rows.map((r) => ({
    conversationId: r.id,
    name: names.get(r.contactId)?.name ?? 'Contacto',
    preview: previewBy.get(r.id)?.trim() || null,
    since: r.lastMsgAt ?? r.updatedAt,
    urgent: r.urgent,
  }));
}

async function loadConfirmations(tenantId: string, now: Date): Promise<AttentionConfirmation[]> {
  const rows = await db
    .select({
      appointmentId: agendaAppointments.id,
      patientName: agendaAppointments.patientName,
      phone: agendaAppointments.patientPhone,
      startsAt: agendaAppointments.startsAt,
      callsDone: appointmentDayOf.callsDone,
    })
    .from(appointmentDayOf)
    .innerJoin(agendaAppointments, eq(agendaAppointments.id, appointmentDayOf.appointmentId))
    .where(
      and(
        eq(appointmentDayOf.tenantId, tenantId),
        eq(agendaAppointments.tenantId, tenantId),
        isNotNull(appointmentDayOf.reminderSentAt),
        isNull(appointmentDayOf.outcome),
        eq(agendaAppointments.status, 'SCHEDULED'),
        gt(agendaAppointments.startsAt, now),
        lt(agendaAppointments.startsAt, new Date(now.getTime() + 24 * 3_600_000)),
      ),
    )
    .orderBy(agendaAppointments.startsAt)
    .limit(LIMIT);
  return rows;
}

async function loadReviews(tenantId: string): Promise<AttentionReview[]> {
  const rows = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      reason: patients.reviewReason,
    })
    .from(patients)
    .where(and(eq(patients.tenantId, tenantId), eq(patients.needsHumanReview, true)))
    .orderBy(desc(patients.updatedAt))
    .limit(LIMIT);
  return rows.map((r) => ({ patientId: r.id, name: patientFullName(r), reason: r.reason }));
}
