import 'server-only';
import { decrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { calls } from '@/lib/db/schema';
import { type SQL, and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';

export type CallRow = typeof calls.$inferSelect;

/**
 * Momento efectivo de la llamada. `started_at` puede faltar (webhook perdido,
 * llamada creada desde otro flujo), así que caemos a `created_at` para que la
 * fila igual ordene y entre en los rangos de fecha en vez de desaparecer.
 */
const occurredAt = sql`COALESCE(${calls.startedAt}, ${calls.createdAt})`;

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
  const filter = typeof limitOrFilter === 'number' ? { limit: limitOrFilter } : limitOrFilter;
  const limit = filter.limit ?? 50;

  const conditions: SQL[] = [eq(calls.tenantId, tenantId)];
  if (filter.intent) conditions.push(eq(calls.intent, filter.intent));
  if (filter.sentiment) conditions.push(eq(calls.sentiment, filter.sentiment));
  if (filter.since) conditions.push(sql`${occurredAt} >= ${filter.since}`);
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
    .orderBy(desc(occurredAt))
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
export async function getCallTranscript(tenantId: string, callId: string): Promise<string | null> {
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
    .where(and(eq(calls.tenantId, tenantId), sql`${occurredAt} >= ${startOfToday}`));

  const yesterdayCount = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), sql`${occurredAt} >= ${startOfYesterday}`));

  const callsToday = todayRows.length;
  const durations = todayRows.map((r) => r.durationSeconds).filter((d): d is number => d !== null);
  const avgDurationSec =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

  const booked = todayRows.filter((r) => r.intent === 'agendar').length;
  const conversionRate = callsToday === 0 ? 0 : Math.round((booked / callsToday) * 100);

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
  // Source of truth: GHL appointments. Si falla / no hay GHL, fallback a
  // los appointments registrados en customData de calls (creados por el agente).
  try {
    const { listUpcomingAppointments } = await import('@/lib/ghl/calendars');
    const ghlItems = await listUpcomingAppointments(tenantId, 14);
    if (ghlItems.length > 0) {
      return ghlItems.slice(0, limit).map((a) => ({
        callId: a.id, // usamos el appointment id como key
        patientName: a.contactName ?? null,
        phone: null,
        treatmentName: a.title ?? a.calendarName,
        startTime: new Date(a.startTime),
      }));
    }
  } catch (err) {
    console.error('[getUpcomingAppointments] GHL fallo, fallback local:', err);
  }

  // Fallback local
  const rows = await db
    .select({
      callId: calls.id,
      fromNumber: calls.fromNumber,
      customData: calls.customData,
    })
    .from(calls)
    .where(
      and(eq(calls.tenantId, tenantId), eq(calls.intent, 'agendar'), isNotNull(calls.customData)),
    )
    .orderBy(desc(occurredAt))
    .limit(50);

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
 * Llamadas a las que les falta inicio o duración — candidatas a que el backfill
 * las recupere desde `call_events` / la API de Retell.
 */
export async function countCallsMissingMetadata(tenantId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(calls)
    .where(
      and(
        eq(calls.tenantId, tenantId),
        sql`(${calls.startedAt} IS NULL OR ${calls.durationSeconds} IS NULL)`,
      ),
    );
  return row?.total ?? 0;
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
      and(eq(calls.tenantId, tenantId), sql`${occurredAt} >= ${since}`, isNotNull(calls.intent)),
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
