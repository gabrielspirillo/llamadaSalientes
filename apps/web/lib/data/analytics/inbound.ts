import 'server-only';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { addDaysToKey, localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { and, eq, sql } from 'drizzle-orm';

/** Ver nota en calls-list.ts: started_at puede faltar, created_at es el fallback. */
const occurredAtSql = sql<Date>`COALESCE(${calls.startedAt}, ${calls.createdAt})`;

export type AnalyticsRange = 'today' | '7d' | '30d';

/** Medianoche local de la clínica de hoy (o de hace 7/30 días). Con la del
 *  servidor (UTC) "hoy" empezaba a las 01:00/02:00 de Madrid. */
function rangeStartKey(range: AnalyticsRange, tz: string): string {
  const today = localDateKey(new Date(), tz);
  return range === 'today' ? today : addDaysToKey(today, range === '7d' ? -7 : -30);
}

function keyToUtc(key: string, tz: string): Date {
  const p = parseDateKey(key);
  if (!p) return new Date();
  return zonedToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export async function getInboundAnalytics(tenantId: string, range: AnalyticsRange) {
  const tz = await getTenantTimezone(tenantId);
  const startKey = rangeStartKey(range, tz);
  const start = keyToUtc(startKey, tz);

  const rows = await db
    .select({
      durationSeconds: calls.durationSeconds,
      intent: calls.intent,
      sentiment: calls.sentiment,
      transferred: calls.transferred,
      startedAt: occurredAtSql,
    })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        // "Entrantes": las salientes van en su propia pestaña.
        sql`${calls.direction} IS DISTINCT FROM 'outbound'`,
        sql`${occurredAtSql} >= ${start.toISOString()}::timestamptz`,
      ),
    );

  const total = rows.length;
  const durations = rows.map((r) => r.durationSeconds).filter((d): d is number => d !== null);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  const booked = rows.filter((r) => r.intent === 'agendar').length;
  const transferred = rows.filter((r) => r.transferred).length;
  const containment = total === 0 ? 100 : Math.round(((total - transferred) / total) * 100);

  // Distribución por hora (24 buckets)
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, calls: 0 }));
  for (const r of rows) {
    if (r.startedAt) {
      const bucket = byHour[localParts(new Date(r.startedAt), tz).hour % 24];
      if (bucket) bucket.calls += 1;
    }
  }

  // Por intención
  const intentMap = new Map<string, number>();
  for (const r of rows) {
    const key = r.intent ?? 'sin_clasificar';
    intentMap.set(key, (intentMap.get(key) ?? 0) + 1);
  }
  const intents = Array.from(intentMap.entries())
    .map(([intent, count]) => ({ intent, count }))
    .sort((a, b) => b.count - a.count);

  // Por día (1 bucket por día, desde `start` hasta hoy)
  const todayKey = localDateKey(new Date(), tz);
  const days: { date: string; calls: number; agendar: number; cancelar: number; otro: number }[] =
    [];
  for (let k = startKey; k <= todayKey; k = addDaysToKey(k, 1)) {
    days.push({ date: k, calls: 0, agendar: 0, cancelar: 0, otro: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const r of rows) {
    if (!r.startedAt) continue;
    const key = localDateKey(new Date(r.startedAt), tz);
    const idx = dayIndex.get(key);
    if (idx === undefined) continue;
    const day = days[idx];
    if (!day) continue;
    day.calls += 1;
    if (r.intent === 'agendar') day.agendar += 1;
    else if (r.intent === 'cancelar') day.cancelar += 1;
    else day.otro += 1;
  }

  return {
    total,
    avgDurationSec: avgDuration,
    booked,
    containment,
    transferred,
    byHour,
    intents,
    byDay: days,
  };
}

export type InboundAnalytics = Awaited<ReturnType<typeof getInboundAnalytics>>;
