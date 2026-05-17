import 'server-only';
import { db } from '@/lib/db/client';
import { outboundCampaigns, outboundTargets, schedulingOffers } from '@/lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { daysAgo, startOfCurrentMonth } from './shared';

// ─────────────────────────────────────────────────────────────────────────────
// Analytics del módulo Llamadas Salientes.
//
// Notas sobre el status de outbound_targets:
//   pending | queued | ongoing      → en curso
//   ended                            → llamada completada (contacto real)
//   voicemail | no_answer | busy     → intento sin contacto humano
//   failed | skipped                 → error o descartado
// ─────────────────────────────────────────────────────────────────────────────

export type OutboundKPIs = {
  callsAttempted: number;
  ended: number;
  noAnswer: number;
  failed: number;
  contactRate: number; // 0..1
  completionRate: number; // 0..1
  revenueAttributedCentsMTD: number;
  appointmentsBookedMTD: number;
};

export async function getOutboundKPIs(tenantId: string, days = 30): Promise<OutboundKPIs> {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      ended: sql<number>`count(*) filter (where ${outboundTargets.status} = 'ended')::int`,
      noAnswer: sql<number>`count(*) filter (where ${outboundTargets.status} in ('voicemail','no_answer','busy'))::int`,
      failed: sql<number>`count(*) filter (where ${outboundTargets.status} in ('failed','skipped'))::int`,
    })
    .from(outboundTargets)
    .where(
      and(
        eq(outboundTargets.tenantId, tenantId),
        gte(outboundTargets.lastAttemptAt, since),
      ),
    );

  const total = row?.total ?? 0;
  const ended = row?.ended ?? 0;
  const noAnswer = row?.noAnswer ?? 0;
  const failed = row?.failed ?? 0;

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
        eq(schedulingOffers.source, 'outbound'),
        gte(schedulingOffers.acceptedAt, monthStart),
      ),
    );

  return {
    callsAttempted: total,
    ended,
    noAnswer,
    failed,
    contactRate: total > 0 ? ended / total : 0,
    completionRate: total > 0 ? (ended + noAnswer) / total : 0,
    revenueAttributedCentsMTD: revenue?.cents ?? 0,
    appointmentsBookedMTD: revenue?.count ?? 0,
  };
}

export type OutboundDailyPoint = {
  date: string; // YYYY-MM-DD
  attempted: number;
  ended: number;
  failed: number;
};

export async function getOutboundDailyTrend(
  tenantId: string,
  days = 30,
): Promise<OutboundDailyPoint[]> {
  const since = daysAgo(days);
  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${outboundTargets.lastAttemptAt}), 'YYYY-MM-DD')`,
      attempted: sql<number>`count(*)::int`,
      ended: sql<number>`count(*) filter (where ${outboundTargets.status} = 'ended')::int`,
      failed: sql<number>`count(*) filter (where ${outboundTargets.status} in ('failed','skipped'))::int`,
    })
    .from(outboundTargets)
    .where(
      and(
        eq(outboundTargets.tenantId, tenantId),
        gte(outboundTargets.lastAttemptAt, since),
      ),
    )
    .groupBy(sql`date_trunc('day', ${outboundTargets.lastAttemptAt})`)
    .orderBy(sql`date_trunc('day', ${outboundTargets.lastAttemptAt})`);

  return rows;
}

export type CampaignPerformance = {
  campaignId: string;
  name: string;
  status: string;
  attempted: number;
  ended: number;
  contactRate: number;
};

export async function getCampaignPerformance(
  tenantId: string,
  days = 30,
  limit = 10,
): Promise<CampaignPerformance[]> {
  const since = daysAgo(days);
  const rows = await db
    .select({
      campaignId: outboundCampaigns.id,
      name: outboundCampaigns.name,
      status: outboundCampaigns.status,
      attempted: sql<number>`count(${outboundTargets.id})::int`,
      ended: sql<number>`count(${outboundTargets.id}) filter (where ${outboundTargets.status} = 'ended')::int`,
    })
    .from(outboundCampaigns)
    .leftJoin(outboundTargets, eq(outboundTargets.campaignId, outboundCampaigns.id))
    .where(
      and(
        eq(outboundCampaigns.tenantId, tenantId),
        gte(outboundCampaigns.createdAt, since),
      ),
    )
    .groupBy(outboundCampaigns.id, outboundCampaigns.name, outboundCampaigns.status)
    .orderBy(desc(outboundCampaigns.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    contactRate: r.attempted > 0 ? r.ended / r.attempted : 0,
  }));
}
