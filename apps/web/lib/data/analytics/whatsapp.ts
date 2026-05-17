import 'server-only';
import { db } from '@/lib/db/client';
import { schedulingOffers, whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { HOUR_MS, daysAgo, startOfCurrentMonth } from './shared';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics del módulo WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

export type WhatsappKPIs = {
  activeConversations: number;
  handoffConversations: number;
  handoffRate: number; // 0..1
  messagesLast24h: number;
  revenueAttributedCentsMTD: number;
  appointmentsBookedMTD: number;
};

export async function getWhatsappKPIs(tenantId: string): Promise<WhatsappKPIs> {
  const [conv] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${whatsappConversations.status} = 'ACTIVE')::int`,
      handoff: sql<number>`count(*) filter (where ${whatsappConversations.status} = 'HANDOFF')::int`,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.tenantId, tenantId));

  const since24h = new Date(Date.now() - 24 * HOUR_MS);
  const [msg] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        gte(whatsappMessages.createdAt, since24h),
      ),
    );

  const monthStart = startOfCurrentMonth();
  const [revenue] = await db
    .select({
      cents: sql<number>`coalesce(sum(${schedulingOffers.estimatedRevenueCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(schedulingOffers)
    .where(
      and(
        eq(schedulingOffers.tenantId, tenantId),
        eq(schedulingOffers.source, 'whatsapp'),
        gte(schedulingOffers.acceptedAt, monthStart),
      ),
    );

  const total = conv?.total ?? 0;
  const handoff = conv?.handoff ?? 0;

  return {
    activeConversations: conv?.active ?? 0,
    handoffConversations: handoff,
    handoffRate: total > 0 ? handoff / total : 0,
    messagesLast24h: msg?.count ?? 0,
    revenueAttributedCentsMTD: revenue?.cents ?? 0,
    appointmentsBookedMTD: revenue?.count ?? 0,
  };
}

export type MessagesByHourPoint = {
  hour: number; // 0..23
  inbound: number;
  outbound: number;
};

/**
 * Mensajes de las últimas 24h agrupados por hora del día (0-23).
 * Útil para detectar picos de actividad. Hora calculada en UTC server-side;
 * la UI puede re-mapear a timezone del tenant si hace falta.
 */
export async function getMessagesByHour(tenantId: string): Promise<MessagesByHourPoint[]> {
  const since = new Date(Date.now() - 24 * HOUR_MS);
  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${whatsappMessages.createdAt})::int`,
      direction: whatsappMessages.direction,
      count: sql<number>`count(*)::int`,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        gte(whatsappMessages.createdAt, since),
      ),
    )
    .groupBy(sql`extract(hour from ${whatsappMessages.createdAt})`, whatsappMessages.direction);

  const buckets: MessagesByHourPoint[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    inbound: 0,
    outbound: 0,
  }));
  for (const r of rows) {
    const bucket = buckets[r.hour];
    if (!bucket) continue;
    if (r.direction === 'INBOUND') bucket.inbound += r.count;
    else if (r.direction === 'OUTBOUND') bucket.outbound += r.count;
  }
  return buckets;
}

export type ConversationStatusBreakdown = {
  active: number;
  handoff: number;
  closed: number;
};

export async function getConversationStatusBreakdown(
  tenantId: string,
): Promise<ConversationStatusBreakdown> {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${whatsappConversations.status} = 'ACTIVE')::int`,
      handoff: sql<number>`count(*) filter (where ${whatsappConversations.status} = 'HANDOFF')::int`,
      closed: sql<number>`count(*) filter (where ${whatsappConversations.status} = 'CLOSED')::int`,
    })
    .from(whatsappConversations)
    .where(eq(whatsappConversations.tenantId, tenantId));

  return {
    active: row?.active ?? 0,
    handoff: row?.handoff ?? 0,
    closed: row?.closed ?? 0,
  };
}
