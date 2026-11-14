import 'server-only';
import { and, count, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import type { AppointmentSource, AppointmentStatus } from '@/lib/agenda/shared';
import { loadSpecialRangesMap } from '@/lib/agenda/special-days-db';
import { type WeekDay, buildWeekStrip } from '@/lib/data/analytics/month-model';
import { db } from '@/lib/db/client';
import {
  advanceOffers,
  agendaAppointments,
  professionalShifts,
  professionals,
  tasks,
  treatments,
  whatsappConversations,
} from '@/lib/db/schema';
import {
  addDaysToKey,
  localDateKey,
  localParts,
  parseDateKey,
  weekdayOfKey,
  zonedToUtc,
} from '@/lib/tasks/tz';

/**
 * Lo que la clínica mira al abrir el panel: el día de hoy en una línea, lo
 * que está esperando a alguien, cómo va la semana y qué hizo el asistente.
 * Todo sale de la agenda propia; sin agenda, el panel enseña lo de siempre.
 */

export interface TodayItem {
  id: string;
  time: string;
  minute: number;
  patientName: string;
  patientKey: string;
  status: AppointmentStatus;
  treatmentName: string | null;
  professionalName: string;
  firstVisit: boolean;
}

export interface TodayBoard {
  dateKey: string;
  nowMinute: number;
  items: TodayItem[];
  attention: {
    unconfirmed: number;
    handoffs: number;
    overdueTasks: number;
    pendingOffers: number;
  };
  weekly: { weekStart: string; label: string; count: number; current: boolean }[];
  /** Los 7 días desde mañana: lo que enseña el bloque «Hoy» un día sin citas. */
  week: WeekDay[];
  assistant: {
    id: string;
    patientName: string;
    patientKey: string;
    source: AppointmentSource;
    startsAt: Date;
    createdAt: Date;
  }[];
}

const BUSY: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

function dayStart(key: string, tz: string): Date {
  const p = parseDateKey(key);
  return p ? zonedToUtc(p.year, p.month, p.day, 0, 0, tz) : new Date();
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export async function getTodayBoard(tenantId: string, tz: string): Promise<TodayBoard> {
  const now = new Date();
  const todayKey = localDateKey(now, tz);
  const todayStart = dayStart(todayKey, tz);
  const tomorrowStart = dayStart(addDaysToKey(todayKey, 1), tz);
  const np = localParts(now, tz);
  const nowMinute = np.hour * 60 + np.minute;

  // Lunes de esta semana y 7 semanas atrás.
  const p = parseDateKey(todayKey);
  const dow = p ? new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() : 1;
  const mondayKey = addDaysToKey(todayKey, -((dow + 6) % 7));
  const firstWeekKey = addDaysToKey(mondayKey, -7 * 7);
  const weeksStart = dayStart(firstWeekKey, tz);
  const weeksEnd = dayStart(addDaysToKey(mondayKey, 7), tz);

  const weekKeys = Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i + 1));
  const weekFrom = tomorrowStart;
  const weekTo = dayStart(addDaysToKey(todayKey, 8), tz);
  const [
    todayRows,
    unconfirmed,
    handoffs,
    overdue,
    offers,
    weekRows,
    assistantRows,
    nextRows,
    shiftRows,
    specials,
  ] = await Promise.all([
    db
      .select({
        id: agendaAppointments.id,
        startsAt: agendaAppointments.startsAt,
        patientName: agendaAppointments.patientName,
        patientKey: agendaAppointments.patientKey,
        status: agendaAppointments.status,
        firstVisit: agendaAppointments.isFirstVisit,
        treatmentName: treatments.name,
        professionalName: professionals.fullName,
      })
      .from(agendaAppointments)
      .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
      .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          gte(agendaAppointments.startsAt, todayStart),
          lt(agendaAppointments.startsAt, tomorrowStart),
          ne(agendaAppointments.status, 'CANCELLED'),
        ),
      )
      .orderBy(agendaAppointments.startsAt),
    db
      .select({ n: count() })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          eq(agendaAppointments.status, 'SCHEDULED'),
          gte(agendaAppointments.startsAt, now),
          lt(agendaAppointments.startsAt, dayStart(addDaysToKey(todayKey, 2), tz)),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0),
    db
      .select({ n: count() })
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.tenantId, tenantId),
          eq(whatsappConversations.status, 'HANDOFF'),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          ne(tasks.status, 'DONE'),
          isNull(tasks.archivedAt),
          lt(tasks.dueAt, now),
        ),
      )
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0),
    db
      .select({ n: count() })
      .from(advanceOffers)
      .where(and(eq(advanceOffers.tenantId, tenantId), eq(advanceOffers.status, 'SENT')))
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => 0),
    db
      .select({
        week: sql<string>`date_trunc('week', ${agendaAppointments.startsAt} at time zone ${tz})::date::text`,
        n: count(),
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.status, BUSY),
          gte(agendaAppointments.startsAt, weeksStart),
          lt(agendaAppointments.startsAt, weeksEnd),
        ),
      )
      .groupBy(sql`1`)
      .catch(() => [] as { week: string; n: number }[]),
    db
      .select({
        id: agendaAppointments.id,
        patientName: agendaAppointments.patientName,
        patientKey: agendaAppointments.patientKey,
        source: agendaAppointments.source,
        startsAt: agendaAppointments.startsAt,
        createdAt: agendaAppointments.createdAt,
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.source, ['WHATSAPP_AGENT', 'VOICE_AGENT', 'WAITLIST']),
          gte(agendaAppointments.createdAt, dayStart(addDaysToKey(todayKey, -14), tz)),
        ),
      )
      .orderBy(desc(agendaAppointments.createdAt))
      .limit(6)
      .catch(() => []),
    db
      .select({
        startsAt: agendaAppointments.startsAt,
        endsAt: agendaAppointments.endsAt,
        firstVisit: agendaAppointments.isFirstVisit,
      })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.status, BUSY),
          gte(agendaAppointments.startsAt, weekFrom),
          lt(agendaAppointments.startsAt, weekTo),
        ),
      )
      .catch(() => []),
    db
      .select({
        professionalId: professionalShifts.professionalId,
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
      )
      .catch(() => []),
    loadSpecialRangesMap(tenantId, weekKeys[0] ?? todayKey, weekKeys[6] ?? todayKey),
  ]);

  const week = buildWeekStrip({
    dayKeys: weekKeys,
    weekdayOf: weekdayOfKey,
    appointments: nextRows.map((r) => {
      const lp = localParts(r.startsAt, tz);
      return {
        dayKey: localDateKey(r.startsAt, tz),
        startMinute: lp.hour * 60 + lp.minute,
        minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60_000),
        firstVisit: Boolean(r.firstVisit),
      };
    }),
    shifts: shiftRows,
    specials,
  });

  const byWeek = new Map(weekRows.map((r) => [r.week, Number(r.n)]));
  const weekly: TodayBoard['weekly'] = [];
  for (let i = 7; i >= 0; i--) {
    const key = addDaysToKey(mondayKey, -7 * i);
    const kp = parseDateKey(key);
    const label = kp
      ? new Date(Date.UTC(kp.year, kp.month - 1, kp.day))
          .toLocaleDateString('es-ES', {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          })
          .replace('.', '')
          .replace(/([a-z]{3})[a-z]+$/, '$1')
      : key;
    weekly.push({ weekStart: key, label, count: byWeek.get(key) ?? 0, current: i === 0 });
  }

  return {
    dateKey: todayKey,
    nowMinute,
    items: todayRows.map((r) => {
      const lp = localParts(r.startsAt, tz);
      const minute = lp.hour * 60 + lp.minute;
      return {
        id: r.id,
        time: hhmm(minute),
        minute,
        patientName: r.patientName,
        patientKey: r.patientKey,
        status: r.status as AppointmentStatus,
        treatmentName: r.treatmentName,
        professionalName: r.professionalName,
        firstVisit: Boolean(r.firstVisit),
      };
    }),
    attention: { unconfirmed, handoffs, overdueTasks: overdue, pendingOffers: offers },
    weekly,
    week,
    assistant: assistantRows.map((r) => ({ ...r, source: r.source as AppointmentSource })),
  };
}

/** Datos de muestra para "Ver ejemplo": fijos, sin base. */
export function getDemoTodayBoard(tz: string): TodayBoard {
  const now = new Date();
  const todayKey = localDateKey(now, tz);
  const np = localParts(now, tz);
  const names = [
    ['Mateo Ruiz Prado', 'PRIMERA VISITA', 'COMPLETED', true],
    ['Vega Soler Ibáñez', 'VISITA RECURRENTE', 'COMPLETED', false],
    ['Noa Martín Gil', 'VISITA RECURRENTE', 'IN_PROGRESS', false],
    ['Leo Castro Vidal', 'PRIMERA VISITA', 'CONFIRMED', true],
    ['Julia Peña Mora', 'VISITA RECURRENTE', 'CONFIRMED', false],
    ['Hugo Lara Sanz', 'VISITA RECURRENTE', 'SCHEDULED', false],
    ['Aitana Roca Nieto', 'VISITA RECURRENTE', 'SCHEDULED', false],
  ] as const;
  const base = Math.max(9 * 60, Math.min(np.hour * 60 + np.minute - 2 * 60, 16 * 60));
  const items: TodayItem[] = names.map(([n, t, st, fv], i) => {
    const minute = base + i * 45;
    return {
      id: `demo-${i}`,
      time: hhmm(minute),
      minute,
      patientName: n,
      patientKey: 'anon:demo',
      status: st as AppointmentStatus,
      treatmentName: t,
      professionalName: 'Dra. Ejemplo',
      firstVisit: fv,
    };
  });
  const counts = [31, 34, 29, 38, 36, 41, 39, 23];
  const p = parseDateKey(todayKey);
  const dow = p ? new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() : 1;
  const mondayKey = addDaysToKey(todayKey, -((dow + 6) % 7));
  return {
    dateKey: todayKey,
    nowMinute: np.hour * 60 + np.minute,
    items,
    attention: { unconfirmed: 3, handoffs: 2, overdueTasks: 1, pendingOffers: 1 },
    weekly: counts.map((c, i) => {
      const key = addDaysToKey(mondayKey, -7 * (7 - i));
      const kp = parseDateKey(key);
      return {
        weekStart: key,
        label: kp
          ? new Date(Date.UTC(kp.year, kp.month - 1, kp.day))
              .toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })
              .replace('.', '')
              .replace(/([a-z]{3})[a-z]+$/, '$1')
          : key,
        count: c,
        current: i === 7,
      };
    }),
    week: buildWeekStrip({
      dayKeys: Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i + 1)),
      weekdayOf: weekdayOfKey,
      appointments: Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i + 1)).flatMap(
        (dayKey, d) =>
          weekdayOfKey(dayKey) >= 6
            ? []
            : Array.from({ length: [9, 12, 8, 11, 6, 10, 7][d] ?? 8 }, (_, j) => ({
                dayKey,
                startMinute: 900 + j * 30,
                minutes: 30,
                firstVisit: j === 2,
              })),
      ),
      shifts: [1, 2, 3, 4, 5].map((weekday) => ({
        professionalId: 'demo',
        weekday,
        startMinute: 900,
        endMinute: 1200,
      })),
      specials: new Map(),
    }),
    assistant: [
      ['Leo Castro Vidal', 'WHATSAPP_AGENT', 1],
      ['Julia Peña Mora', 'VOICE_AGENT', 3],
      ['Aitana Roca Nieto', 'WHATSAPP_AGENT', 5],
      ['Hugo Lara Sanz', 'WAITLIST', 20],
    ].map(([n, s, h], i) => ({
      id: `demo-a-${i}`,
      patientName: String(n),
      patientKey: 'anon:demo',
      source: s as AppointmentSource,
      startsAt: new Date(now.getTime() + 26 * 3_600_000 * (i + 1)),
      createdAt: new Date(now.getTime() - Number(h) * 3_600_000),
    })),
  };
}
