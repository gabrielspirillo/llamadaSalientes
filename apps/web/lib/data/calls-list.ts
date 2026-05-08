import 'server-only';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { and, desc, eq, gte } from 'drizzle-orm';

export type CallRow = typeof calls.$inferSelect;

export async function listCalls(tenantId: string, limit = 50): Promise<CallRow[]> {
  return db
    .select()
    .from(calls)
    .where(eq(calls.tenantId, tenantId))
    .orderBy(desc(calls.startedAt))
    .limit(limit);
}

export async function getCall(tenantId: string, callId: string): Promise<CallRow | null> {
  const rows = await db
    .select()
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Devuelve el transcript desencriptado para un call. Solo el dueño del tenant.
 */
export async function getCallTranscript(
  tenantId: string,
  callId: string,
): Promise<string | null> {
  const call = await getCall(tenantId, callId);
  if (!call?.transcriptEnc) return null;
  try {
    return decrypt(call.transcriptEnc);
  } catch {
    return null;
  }
}

export type DashboardStats = {
  callsToday: number;
  callsYesterday: number;
  avgDurationSec: number | null;
  conversionRate: number; // % de calls con intent=agendar
  containmentRate: number; // % no transferidas
};

export async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const todayRows = await db
    .select({
      durationSeconds: calls.durationSeconds,
      intent: calls.intent,
      transferred: calls.transferred,
    })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), gte(calls.startedAt, startOfToday)));

  const yesterdayCount = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        gte(calls.startedAt, startOfYesterday),
      ),
    );

  const callsToday = todayRows.length;
  const durations = todayRows
    .map((r) => r.durationSeconds)
    .filter((d): d is number => d !== null);
  const avgDurationSec =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const booked = todayRows.filter((r) => r.intent === 'agendar').length;
  const conversionRate =
    callsToday === 0 ? 0 : Math.round((booked / callsToday) * 100);

  const transferred = todayRows.filter((r) => r.transferred).length;
  const containmentRate =
    callsToday === 0 ? 100 : Math.round(((callsToday - transferred) / callsToday) * 100);

  return {
    callsToday,
    callsYesterday: Math.max(0, yesterdayCount.length - callsToday),
    avgDurationSec,
    conversionRate,
    containmentRate,
  };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '–';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatRelativeTime(date: Date | null): string {
  if (!date) return '–';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}
