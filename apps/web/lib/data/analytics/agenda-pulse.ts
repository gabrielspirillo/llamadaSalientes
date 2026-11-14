import 'server-only';
import type { AppointmentStatus } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import { agendaAppointments, professionalShifts, professionals } from '@/lib/db/schema';
import { addDaysToKey, localDateKey, parseDateKey, weekdayOfKey, zonedToUtc } from '@/lib/tasks/tz';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';

import {
  type SavingPart,
  estimateSavings,
  summarizeRecovered,
} from '@/lib/data/analytics/value-model';

/**
 * Lo que importa del día en una clínica que lleva su agenda en la plataforma,
 * leído de `agenda_appointments` (no de la caché de GoHighLevel, que en estas
 * clínicas se queda vacía) y en la hora de la clínica.
 */
export interface AgendaPulse {
  today: {
    total: number;
    confirmed: number;
    pending: number /** "16:30" (hora de la clínica) o null. */;
    nextTime: string | null;
  };
  /** Minutos reservados / minutos de horario en los próximos 7 días. */
  occupancy: { rate: number; bookedMinutes: number; shiftMinutes: number };
  /** Citas que reservó el asistente (WhatsApp o voz) este mes, y el anterior. */
  assistant: {
    thisMonth: number;
    lastMonth: number;
    daily: number[];
    /** Todas las citas dadas este mes (panel + asistentes + lista de espera). */
    monthBookings: number;
    /** Mensajes que escribió el asistente este mes y en cuántas conversaciones. */
    replies: number;
    conversations: number;
    /** De esos mensajes, los de noche (21-08) o en fin de semana. */
    offHours: number;
  };
  /** Horas que la plataforma le ahorró a recepción este mes (estimación). */
  savings: { totalMinutes: number; parts: SavingPart[] };
  /** Huecos cancelados que se volvieron a llenar con una oferta aceptada. */
  recovered: {
    monthCents: number;
    monthCount: number;
    totalCents: number;
    totalCount: number;
    /** Las últimas 8 semanas, de la más antigua a la actual. */
    weekly: number[];
  };
  /** Faltas y anulaciones de la familia en los últimos 30 días. */
  lost: { rate: number; lost: number; total: number };
  /** Primeras visitas reservadas este mes. */
  firstVisits: number;
  /** Faltas por semana (90 días), para el gráfico de tendencia. */
  noShowSeries: { weekStart: string; rate: number; noShow: number; finished: number }[];
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
  const since90 = dayStart(addDaysToKey(todayKey, -90), timezone);
  const [todayRows, weekBooked, shifts, assistantRows, lostRow, firstRow, weekly] =
    await Promise.all([
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
      db
        .select({
          weekStart: sql<string>`to_char(date_trunc('week', ${agendaAppointments.startsAt} at time zone ${timezone}), 'YYYY-MM-DD')`,
          finished: sql<number>`count(*) filter (where ${agendaAppointments.status} <> 'CANCELLED')::int`,
          noShow: sql<number>`count(*) filter (where ${agendaAppointments.status} = 'NO_SHOW')::int`,
        })
        .from(agendaAppointments)
        .where(
          and(
            tenant,
            gte(agendaAppointments.startsAt, since90),
            lt(agendaAppointments.startsAt, now),
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ]);

  const monthIso = monthStart.toISOString();
  const [nextRow, monthRow, replyRows, dayOfRows, offerRow, recoveredRows, fallbackRows] =
    await Promise.all([
      db
        .select({ at: sql<Date | null>`min(${agendaAppointments.startsAt})` })
        .from(agendaAppointments)
        .where(
          and(
            tenant,
            gte(agendaAppointments.startsAt, now),
            lt(agendaAppointments.startsAt, tomorrowStart),
            inArray(agendaAppointments.status, BUSY),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(agendaAppointments)
        .where(
          and(
            tenant,
            gte(agendaAppointments.createdAt, monthStart),
            sql`${agendaAppointments.source} <> 'IMPORT'`,
          ),
        ),
      // Mensajes del asistente. Los recordatorios del día y las ofertas de
      // hueco salen firmados como equipo (HUMAN), así que no se cuentan aquí
      // y no se suman dos veces con su propia fila.
      db.execute<{ replies: number; convs: number; off: number }>(sql`
        select count(*)::int as replies,
               count(distinct conversation_id)::int as convs,
               count(*) filter (
                 where extract(hour from created_at at time zone ${timezone}) < 8
                    or extract(hour from created_at at time zone ${timezone}) >= 21
                    or extract(isodow from created_at at time zone ${timezone}) >= 6
               )::int as off
        from whatsapp_messages
        where tenant_id = ${tenantId}::uuid
          and sender_type = 'AGENT'
          and direction = 'OUTBOUND'
          and created_at >= ${monthIso}::timestamptz
      `),
      db.execute<{ n: number }>(sql`
        select (count(*) filter (where reminder_sent_at >= ${monthIso}::timestamptz)
              + count(*) filter (where nudge_sent_at >= ${monthIso}::timestamptz))::int as n
        from appointment_day_of
        where tenant_id = ${tenantId}::uuid
          and (reminder_sent_at >= ${monthIso}::timestamptz or nudge_sent_at >= ${monthIso}::timestamptz)
      `),
      db.execute<{ n: number }>(sql`
        select count(*)::int as n from advance_offers
        where tenant_id = ${tenantId}::uuid and sent_at >= ${monthIso}::timestamptz
      `),
      // Precio de cada hueco recuperado: lo cobrado en esa cita, si no el
      // precio de su tratamiento (o el de la petición de prioridad).
      db.execute<{ answered_at: string | Date; cents: number | null }>(sql`
        select ao.answered_at,
               coalesce(
                 (select pc.amount_cents from patient_charges pc
                   where pc.tenant_id = ao.tenant_id and pc.appointment_id = ao.appointment_id
                     and pc.amount_cents > 0
                   limit 1),
                 (select t.price_cents from agenda_appointments a
                    join treatments t on t.id = a.treatment_id
                   where a.tenant_id = ao.tenant_id and a.id = ao.appointment_id),
                 (select t.price_cents from slot_priority_requests r
                    join treatments t on t.id = r.treatment_id
                   where r.tenant_id = ao.tenant_id and r.id = ao.request_id)
               )::int as cents
        from advance_offers ao
        where ao.tenant_id = ${tenantId}::uuid
          and ao.status = 'ACCEPTED'
          and ao.answered_at is not null
        order by ao.answered_at desc
        limit 5000
      `),
      db.execute<{ charges: number | null; treatments: number | null }>(sql`
        select
          (select avg(amount_cents)::int from patient_charges
            where tenant_id = ${tenantId}::uuid and amount_cents > 0) as charges,
          (select avg(price_cents)::int from treatments
            where tenant_id = ${tenantId}::uuid and price_cents > 0) as treatments
      `),
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

  const replyRow = replyRows[0];
  const savings = estimateSavings({
    reply: replyRow?.replies ?? 0,
    booking: thisMonth,
    reminder: dayOfRows[0]?.n ?? 0,
    offer: offerRow[0]?.n ?? 0,
  });
  // Lunes de las últimas 8 semanas, en la hora de la clínica.
  const todayDow = weekdayOfKey(todayKey);
  const thisMonday = addDaysToKey(todayKey, -(todayDow - 1));
  const weekStarts = Array.from({ length: 8 }, (_, i) =>
    dayStart(addDaysToKey(thisMonday, (i - 7) * 7), timezone),
  );
  const recovered = summarizeRecovered(
    recoveredRows.map((r) => ({
      answeredAt: new Date(r.answered_at),
      cents: r.cents == null ? null : Number(r.cents),
    })),
    {
      fallbackCents: Number(fallbackRows[0]?.charges ?? fallbackRows[0]?.treatments ?? 0),
      monthStart,
      weekStarts,
    },
  );
  const nextAt = nextRow[0]?.at ? new Date(nextRow[0].at) : null;
  const nextTime = nextAt
    ? new Intl.DateTimeFormat('es-ES', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(nextAt)
    : null;

  return {
    today: { total, confirmed: total - pending, pending, nextTime },
    occupancy: {
      rate: shiftMinutes > 0 ? Math.min(1, bookedMinutes / shiftMinutes) : 0,
      bookedMinutes,
      shiftMinutes,
    },
    assistant: {
      thisMonth,
      lastMonth,
      daily,
      monthBookings: monthRow[0]?.n ?? 0,
      replies: replyRow?.replies ?? 0,
      conversations: replyRow?.convs ?? 0,
      offHours: replyRow?.off ?? 0,
    },
    savings,
    recovered,
    lost: { rate: lostTotal > 0 ? lost / lostTotal : 0, lost, total: lostTotal },
    firstVisits: firstRow[0]?.n ?? 0,
    noShowSeries: weekly.map((w) => ({
      weekStart: w.weekStart,
      finished: w.finished,
      noShow: w.noShow,
      rate: w.finished > 0 ? w.noShow / w.finished : 0,
    })),
  };
}
