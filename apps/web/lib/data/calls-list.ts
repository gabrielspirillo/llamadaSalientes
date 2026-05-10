import 'server-only';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { and, count, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';

export type CallRow = typeof calls.$inferSelect;

export type CallsFilter = {
  intent?: string;
  sentiment?: string;
  q?: string;
  since?: Date;
};

export async function listCalls(
  tenantId: string,
  limitOrFilter: number | (CallsFilter & { limit?: number }) = 50,
): Promise<CallRow[]> {
  const filter =
    typeof limitOrFilter === 'number' ? { limit: limitOrFilter } : limitOrFilter;
  const limit = filter.limit ?? 50;

  const conditions: SQL[] = [eq(calls.tenantId, tenantId)];
  if (filter.intent) conditions.push(eq(calls.intent, filter.intent));
  if (filter.sentiment) conditions.push(eq(calls.sentiment, filter.sentiment));
  if (filter.since) conditions.push(gte(calls.startedAt, filter.since));
  if (filter.q && filter.q.trim().length > 0) {
    const q = `%${filter.q.trim()}%`;
    const search = or(
      ilike(calls.fromNumber, q),
      ilike(calls.toNumber, q),
      ilike(calls.summary, q),
    );
    if (search) conditions.push(search);
  }

  return db
    .select()
    .from(calls)
    .where(and(...conditions))
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

/**
 * Próximas citas: lee customData.appointment_start de calls que tengan
 * cita agendada en el futuro.
 */
export type UpcomingAppointment = {
  callId: string;
  patientName: string | null;
  phone: string | null;
  treatmentName: string | null;
  startTime: Date;
};

export async function getUpcomingAppointments(
  tenantId: string,
  limit = 5,
): Promise<UpcomingAppointment[]> {
  const rows = await db
    .select({
      callId: calls.id,
      fromNumber: calls.fromNumber,
      customData: calls.customData,
    })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        eq(calls.intent, 'agendar'),
        isNotNull(calls.customData),
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(50); // luego filtramos en memoria por appointment_start futuro

  const now = Date.now();
  const upcoming: UpcomingAppointment[] = [];
  for (const r of rows) {
    const cd = (r.customData ?? {}) as {
      patient_name?: string;
      treatment_name?: string;
      appointment_start?: string;
    };
    if (!cd.appointment_start) continue;
    const start = new Date(cd.appointment_start);
    if (Number.isNaN(start.getTime()) || start.getTime() <= now) continue;
    upcoming.push({
      callId: r.callId,
      patientName: cd.patient_name ?? null,
      phone: r.fromNumber,
      treatmentName: cd.treatment_name ?? null,
      startTime: start,
    });
  }
  upcoming.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return upcoming.slice(0, limit);
}

/**
 * Cuenta llamadas con transcript pero sin intent (candidatas a re-procesar).
 */
export async function countCallsPendingIntent(tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: calls.id })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        sql`${calls.transcriptEnc} IS NOT NULL AND ${calls.intent} IS NULL`,
      ),
    );
  return rows.length;
}

/**
 * Cantidades agregadas por motivo en los últimos 7 días.
 * Para mini-charts en el dashboard.
 */
export async function getMotivoBreakdown(
  tenantId: string,
): Promise<Array<{ motivo: string; count: number }>> {
  const since = new Date();
  since.setDate(since.getDate() - 7);

  const rows = await db
    .select({
      intent: calls.intent,
      total: count(),
    })
    .from(calls)
    .where(
      and(eq(calls.tenantId, tenantId), gte(calls.startedAt, since), isNotNull(calls.intent)),
    )
    .groupBy(calls.intent);

  return rows.map((r) => ({
    motivo: r.intent ?? 'sin_clasificar',
    count: Number(r.total),
  }));
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
