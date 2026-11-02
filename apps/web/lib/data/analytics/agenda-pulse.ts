import 'server-only';
import type { AppointmentStatus } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import { agendaAppointments, professionalShifts, professionals } from '@/lib/db/schema';
import { addDaysToKey, localDateKey, parseDateKey, weekdayOfKey, zonedToUtc } from '@/lib/tasks/tz';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

/**
 * Lo que importa del día en una clínica que lleva su agenda en la plataforma,
 * leído de `agenda_appointments` (no de la caché de GoHighLevel, que en estas
 * clínicas se queda vacía) y en la hora de la clínica.
 */
export interface AgendaPulse {
  today: { total: number; confirmed: number; pending: number };
  /** Minutos reservados / minutos de horario en los próximos 7 días. */
  occupancy: { rate: number; bookedMinutes: number; shiftMinutes: number };
  /** Citas que reservó el asistente (WhatsApp o voz) este mes, y el anterior. */
  assistant: { thisMonth: number; lastMonth: number; daily: number[] };
  /** Faltas y anulaciones de la familia en los últimos 30 días. */
  lost: { rate: number; lost: number; total: number };
  /** Primeras visitas reservadas este mes. */
  firstVisits: number;
}

const BUSY: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

function dayStart(key: string, tz: string): Date {
  const p = parseDateKey(key);
  return p ? zonedToUtc(p.year, p.month, p.day, 0, 0, tz) : new Date();
}

export async function getAgendaPulse(tenantId: string, timezone: string): Promise<AgendaPulse> {
  const now = new Date();
  const todayKey = localDateKey(now, timezone);
  const todayStart = dayStart(todayKey, timezone);
  const tomorrowStart = dayStart(addDaysToKey(todayKey, 1), timezone);
  const weekEnd = dayStart(addDaysToKey(todayKey, 7), timezone);
  const monthKey = `${todayKey.slice(0, 7)}-01`;
  const monthStart = dayStart(monthKey, timezone);
  const prevMonthKey = (() => {
    const p = parseDateKey(monthKey);
    if (!p) return monthKey;
    const m = p.month === 1 ? 12 : p.month - 1;
    const y = p.month === 1 ? p.year - 1 : p.year;
    return `${y}-${String(m).padStart(2, '0')}-01`;
  })();
  const prevMonthStart = dayStart(prevMonthKey, timezone);
  const since30 = dayStart(addDaysToKey(todayKey, -30), timezone);
  const since14 = dayStart(addDaysToKey(todayKey, -13), timezone);

  const tenant = eq(agendaAppointments.tenantId, tenantId);
  const [todayRows, weekBooked, shifts, assistantRows, lostRow, firstRow] = await Promise.all([
    db
      .select({ status: agendaAppointments.status, n: sql<number>`count(*)::int` })
      .from(agendaAppointments)
      .where(
        and(
          tenant,
          gte(agendaAppointments.startsAt, todayStart),
          lt(agendaAppointments.startsAt, tomorrowStart),
          inArray(agendaAppointments.status, BUSY),
        ),
      )
      .groupBy(agendaAppointments.status),
    db
      .select({
        minutes: sql<number>`coalesce(sum(extract(epoch from (${agendaAppointments.endsAt} - ${agendaAppointments.startsAt})) / 60), 0)::int`,
      })
      .from(agendaAppointments)
      .where(
        and(
          tenant,
          gte(agendaAppointments.startsAt, now),
          lt(agendaAppointments.startsAt, weekEnd),
          inArray(agendaAppointments.status, BUSY),
        ),
      ),
    db
      .select({
        weekday: professionalShifts.weekday,
        startMinute: professionalShifts.startMinute,
        endMinute: professionalShifts.endMinute,
      })
      .from(professionalShifts)
      .innerJoin(professionals, eq(professionals.id, professionalShifts.professionalId))
      .where(
        and(
          eq(professionalShifts.tenantId, tenantId),
          eq(professionalShifts.active, true),
          eq(professionals.active, true),
          eq(professionals.agendaEnabled, true),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(${agendaAppointments.createdAt} at time zone ${timezone}, 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(agendaAppointments)
      .where(
        and(
          tenant,
          gte(agendaAppointments.createdAt, prevMonthStart < since14 ? prevMonthStart : since14),
          inArray(agendaAppointments.source, ['WHATSAPP_AGENT', 'VOICE_AGENT']),
        ),
      )
      .groupBy(sql`1`),
    db
      .select({
        total: sql<number>`count(*)::int`,
        lost: sql<number>`count(*) filter (where ${agendaAppointments.status} = 'NO_SHOW' or (${agendaAppointments.status} = 'CANCELLED' and coalesce(${agendaAppointments.cancelledBy}, 'PATIENT') = 'PATIENT'))::int`,
      })
      .from(agendaAppointments)
      .where(
        and(
          tenant,
          gte(agendaAppointments.startsAt, since30),
          lt(agendaAppointments.startsAt, now),
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agendaAppointments)
      .where(
        and(
          tenant,
          gte(agendaAppointments.createdAt, monthStart),
          eq(agendaAppointments.isFirstVisit, true),
          inArray(agendaAppointments.status, BUSY),
        ),
      ),
  ]);

  const total = todayRows.reduce((s, r) => s + r.n, 0);
  const pending = todayRows.find((r) => r.status === 'SCHEDULED')?.n ?? 0;

  // Horario de los próximos 7 días (desde ahora: lo de hoy ya pasado no cuenta).
  let shiftMinutes = 0;
  const nowMinute = (() => {
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now);
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  })();
  for (let d = 0; d < 7; d++) {
    const key = addDaysToKey(todayKey, d);
    const wd = weekdayOfKey(key);
    for (const s of shifts) {
      if (s.weekday !== wd) continue;
      const from = d === 0 ? Math.max(s.startMinute, nowMinute) : s.startMinute;
      shiftMinutes += Math.max(0, s.endMinute - from);
    }
  }
  const bookedMinutes = weekBooked[0]?.minutes ?? 0;

  const byDay = new Map(assistantRows.map((r) => [r.day, r.n]));
  let thisMonth = 0;
  let lastMonth = 0;
  for (const r of assistantRows) {
    if (r.day >= monthKey) thisMonth += r.n;
    else if (r.day >= prevMonthKey) lastMonth += r.n;
  }
  const daily = Array.from(
    { length: 14 },
    (_, i) => byDay.get(addDaysToKey(todayKey, i - 13)) ?? 0,
  );

  const lostTotal = lostRow[0]?.total ?? 0;
  const lost = lostRow[0]?.lost ?? 0;

  return {
    today: { total, confirmed: total - pending, pending },
    occupancy: {
      rate: shiftMinutes > 0 ? Math.min(1, bookedMinutes / shiftMinutes) : 0,
      bookedMinutes,
      shiftMinutes,
    },
    assistant: { thisMonth, lastMonth, daily },
    lost: { rate: lostTotal > 0 ? lost / lostTotal : 0, lost, total: lostTotal },
    firstVisits: firstRow[0]?.n ?? 0,
  };
}
