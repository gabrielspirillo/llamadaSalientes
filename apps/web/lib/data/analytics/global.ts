import 'server-only';
import { db } from '@/lib/db/client';
import { appointmentsCache, cancelledSlots, schedulingOffers, treatments } from '@/lib/db/schema';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { daysAgo, startOfCurrentMonth, startOfToday, startOfTomorrow } from './shared';

// ─────────────────────────────────────────────────────────────────────────────
// Métricas globales (cross-channel). Aparecen en la franja superior del
// dashboard y no dependen de un módulo específico.
//
// Convenciones:
//   appointments_cache.status (text libre desde GHL) se interpreta como:
//     'no_show'                    → no asistió
//     'completed'                  → asistió y finalizada
//     'scheduled' | 'confirmed'    → próxima
//   Otros valores se ignoran.
// ─────────────────────────────────────────────────────────────────────────────

const NO_SHOW_FINISHED_STATUSES = ['completed', 'no_show'] as const;
const SCHEDULED_STATUSES = ['scheduled', 'confirmed'] as const;

export type NoShowStats = {
  rate: number; // 0..1
  noShow: number;
  finished: number;
};

export async function getNoShowStats(tenantId: string, days = 90): Promise<NoShowStats> {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      finished: sql<number>`coalesce(count(*) filter (where ${appointmentsCache.status} in ('completed','no_show')), 0)::int`,
      noShow: sql<number>`coalesce(count(*) filter (where ${appointmentsCache.status} = 'no_show'), 0)::int`,
    })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gte(appointmentsCache.endTime, since),
        lte(appointmentsCache.endTime, new Date()),
      ),
    );

  const finished = row?.finished ?? 0;
  const noShow = row?.noShow ?? 0;
  return {
    rate: finished > 0 ? noShow / finished : 0,
    noShow,
    finished,
  };
}

export type NoShowSeriesPoint = {
  weekStart: string; // YYYY-MM-DD
  rate: number; // 0..1
  noShow: number;
  finished: number;
};

/**
 * Serie semanal de no-show rate sobre `days` (default 90 = 3 meses).
 * Granularidad semanal porque diaria es demasiado ruidosa en clínicas
 * con bajo volumen.
 */
export async function getNoShowSeries(
  tenantId: string,
  days = 90,
): Promise<NoShowSeriesPoint[]> {
  const since = daysAgo(days);
  const rows = await db
    .select({
      weekStart: sql<string>`to_char(date_trunc('week', ${appointmentsCache.endTime}), 'YYYY-MM-DD')`,
      finished: sql<number>`count(*) filter (where ${appointmentsCache.status} in ('completed','no_show'))::int`,
      noShow: sql<number>`count(*) filter (where ${appointmentsCache.status} = 'no_show')::int`,
    })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gte(appointmentsCache.endTime, since),
        lte(appointmentsCache.endTime, new Date()),
        inArray(appointmentsCache.status, [...NO_SHOW_FINISHED_STATUSES]),
      ),
    )
    .groupBy(sql`date_trunc('week', ${appointmentsCache.endTime})`)
    .orderBy(sql`date_trunc('week', ${appointmentsCache.endTime})`);

  return rows.map((r) => ({
    weekStart: r.weekStart,
    finished: r.finished,
    noShow: r.noShow,
    rate: r.finished > 0 ? r.noShow / r.finished : 0,
  }));
}

export type OptimizedRevenue = {
  cents: number;
  currency: string;
  byChannel: { outbound: number; inbound: number; whatsapp: number };
};

/**
 * Revenue recuperado por slots optimizados en el mes actual (MTD).
 * Asume single-currency por tenant; si hay multi-currency devuelve la
 * dominante por monto.
 */
export async function getOptimizedRevenueMTD(tenantId: string): Promise<OptimizedRevenue> {
  const monthStart = startOfCurrentMonth();
  const rows = await db
    .select({
      source: schedulingOffers.source,
      currency: schedulingOffers.currency,
      cents: sql<number>`coalesce(sum(${schedulingOffers.estimatedRevenueCents}), 0)::int`,
    })
    .from(schedulingOffers)
    .where(
      and(
        eq(schedulingOffers.tenantId, tenantId),
        gte(schedulingOffers.acceptedAt, monthStart),
      ),
    )
    .groupBy(schedulingOffers.source, schedulingOffers.currency);

  // Currency dominante (mayor monto)
  const totalsByCurrency = new Map<string, number>();
  for (const r of rows) {
    totalsByCurrency.set(r.currency, (totalsByCurrency.get(r.currency) ?? 0) + r.cents);
  }
  let dominantCurrency = 'EUR';
  let dominantCents = 0;
  for (const [cur, cents] of totalsByCurrency) {
    if (cents > dominantCents) {
      dominantCurrency = cur;
      dominantCents = cents;
    }
  }

  const byChannel = { outbound: 0, inbound: 0, whatsapp: 0 };
  for (const r of rows) {
    if (r.currency !== dominantCurrency) continue;
    byChannel[r.source] += r.cents;
  }

  return { cents: dominantCents, currency: dominantCurrency, byChannel };
}

export type RecoveryStats = {
  rate: number; // 0..1
  recovered: number;
  totalCancelled: number;
};

/**
 * Tasa de recuperación de cancelaciones: % de slots cancelados que el
 * sistema logró re-agendar a otro paciente.
 */
export async function getCancellationRecoveryStats(
  tenantId: string,
  days = 90,
): Promise<RecoveryStats> {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      recovered: sql<number>`count(*) filter (where ${cancelledSlots.recoveredAt} is not null)::int`,
    })
    .from(cancelledSlots)
    .where(
      and(
        eq(cancelledSlots.tenantId, tenantId),
        gte(cancelledSlots.cancelledAt, since),
      ),
    );

  const total = row?.total ?? 0;
  const recovered = row?.recovered ?? 0;
  return {
    rate: total > 0 ? recovered / total : 0,
    recovered,
    totalCancelled: total,
  };
}

export async function getAppointmentsToday(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appointmentsCache)
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gte(appointmentsCache.startTime, startOfToday()),
        lte(appointmentsCache.startTime, startOfTomorrow()),
        inArray(appointmentsCache.status, [...SCHEDULED_STATUSES]),
      ),
    );
  return row?.count ?? 0;
}

export type TopTreatment = {
  treatmentId: string;
  name: string;
  count: number;
};

/**
 * Top tratamientos por volumen de citas en los últimos `days`. Filtra
 * citas sin tratamiento asignado.
 */
export async function getTopTreatments(
  tenantId: string,
  days = 30,
  limit = 5,
): Promise<TopTreatment[]> {
  const since = daysAgo(days);
  const rows = await db
    .select({
      treatmentId: appointmentsCache.treatmentId,
      name: treatments.name,
      count: sql<number>`count(*)::int`,
    })
    .from(appointmentsCache)
    .innerJoin(treatments, eq(treatments.id, appointmentsCache.treatmentId))
    .where(
      and(
        eq(appointmentsCache.tenantId, tenantId),
        gte(appointmentsCache.startTime, since),
        isNotNull(appointmentsCache.treatmentId),
      ),
    )
    .groupBy(appointmentsCache.treatmentId, treatments.name)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows
    .filter((r): r is { treatmentId: string; name: string; count: number } =>
      r.treatmentId !== null && r.name !== null,
    )
    .map((r) => ({ treatmentId: r.treatmentId, name: r.name, count: r.count }));
}
