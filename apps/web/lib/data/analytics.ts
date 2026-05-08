import 'server-only';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

export type AnalyticsRange = 'today' | '7d' | '30d';

function rangeStart(range: AnalyticsRange): Date {
  const d = new Date();
  if (range === 'today') {
    d.setHours(0, 0, 0, 0);
    return d;
  }
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (range === '7d' ? 7 : 30));
  return d;
}

export async function getAnalytics(tenantId: string, range: AnalyticsRange) {
  const start = rangeStart(range);

  const rows = await db
    .select({
      durationSeconds: calls.durationSeconds,
      intent: calls.intent,
      sentiment: calls.sentiment,
      transferred: calls.transferred,
      startedAt: calls.startedAt,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), gte(calls.startedAt, start)));

  const total = rows.length;
  const durations = rows
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d !== null);
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
      const h = new Date(r.startedAt).getHours();
      byHour[h]!.calls += 1;
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
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: { date: string; calls: number; agendar: number; cancelar: number; otro: number }[] = [];
  for (let d = new Date(start); d.getTime() <= today.getTime(); d = new Date(d.getTime() + dayMs)) {
    days.push({
      date: d.toISOString().slice(0, 10),
      calls: 0,
      agendar: 0,
      cancelar: 0,
      otro: 0,
    });
  }
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  for (const r of rows) {
    if (!r.startedAt) continue;
    const key = new Date(r.startedAt).toISOString().slice(0, 10);
    const idx = dayIndex.get(key);
    if (idx === undefined) continue;
    const day = days[idx]!;
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

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
