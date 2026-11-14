import 'server-only';
import { sql } from 'drizzle-orm';

import { type MonthSummary, daysInMonth, summarizeMonth } from '@/lib/data/analytics/month-model';
import { db } from '@/lib/db/client';
import { addDaysToKey, localDateKey, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';

/**
 * Cómo va el negocio de una clínica con agenda propia: sesiones, familias
 * nuevas e ingresos del mes frente al anterior, y cuántas familias atendidas
 * ya tienen su próxima cita. Una sesión es una cita ya pasada que no se anuló
 * ni se faltó (Respinens no marca «Atendida» en su historia anterior).
 */
export interface BusinessPulse {
  month: MonthSummary;
  daysThisMonth: number;
  monthName: string;
  prevMonthName: string;
  /** Familias distintas atendidas este mes, el mes anterior a estas alturas, y nuevas. */
  families: { month: number; prevSame: number; newMonth: number };
}

function dayStart(key: string, tz: string): Date {
  const p = parseDateKey(key);
  return p ? zonedToUtc(p.year, p.month, p.day, 0, 0, tz) : new Date();
}

function monthName(key: string): string {
  const p = parseDateKey(key);
  if (!p) return '';
  return new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleDateString('es-ES', {
    month: 'long',
    timeZone: 'UTC',
  });
}

export async function getBusinessPulse(tenantId: string, tz: string): Promise<BusinessPulse> {
  const now = new Date();
  const todayKey = localDateKey(now, tz);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const prevMonthStartKey = `${addDaysToKey(monthStartKey, -1).slice(0, 7)}-01`;
  const fromIso = dayStart(prevMonthStartKey, tz).toISOString();
  const nowIso = now.toISOString();
  const monthIso = dayStart(monthStartKey, tz).toISOString();
  const todayDay = Number(todayKey.slice(8, 10));

  const [sessionRows, fallbackRows, familyRows] = await Promise.all([
    db.execute<{ day_key: string; first: boolean | null; cents: number | null }>(sql`
      select to_char(a.starts_at at time zone ${tz}, 'YYYY-MM-DD') as day_key,
             a.is_first_visit as first,
             coalesce(
               (select pc.amount_cents from patient_charges pc
                 where pc.tenant_id = a.tenant_id and pc.appointment_id = a.id
                   and pc.amount_cents > 0
                 limit 1),
               t.price_cents
             )::int as cents
      from agenda_appointments a
      left join treatments t on t.id = a.treatment_id and t.tenant_id = a.tenant_id
      where a.tenant_id = ${tenantId}::uuid
        and a.starts_at >= ${fromIso}::timestamptz
        and a.starts_at < ${nowIso}::timestamptz
        and a.status not in ('CANCELLED', 'NO_SHOW')
      limit 20000
    `),
    db.execute<{ charges: number | null; treatments: number | null }>(sql`
      select
        (select avg(amount_cents)::int from patient_charges
          where tenant_id = ${tenantId}::uuid and amount_cents > 0) as charges,
        (select avg(price_cents)::int from treatments
          where tenant_id = ${tenantId}::uuid and price_cents > 0) as treatments
    `),
    db.execute<{ month: number; prev_same: number; month_new: number }>(sql`
      select
        count(distinct patient_key) filter (where starts_at >= ${monthIso}::timestamptz)::int as month,
        count(distinct patient_key) filter (
          where starts_at < ${monthIso}::timestamptz
            and extract(day from starts_at at time zone ${tz}) <= ${todayDay}
        )::int as prev_same,
        count(distinct patient_key) filter (
          where starts_at >= ${monthIso}::timestamptz and is_first_visit
        )::int as month_new
      from agenda_appointments
      where tenant_id = ${tenantId}::uuid
        and starts_at >= ${fromIso}::timestamptz
        and starts_at < ${nowIso}::timestamptz
        and status not in ('CANCELLED', 'NO_SHOW')
        and patient_key not like 'anon:%'
    `),
  ]);

  const month = summarizeMonth(
    sessionRows.map((r) => ({
      dayKey: r.day_key,
      cents: r.cents == null ? null : Number(r.cents),
      firstVisit: Boolean(r.first),
    })),
    {
      monthStartKey,
      prevMonthStartKey,
      todayKey,
      fallbackCents: Number(fallbackRows[0]?.charges ?? fallbackRows[0]?.treatments ?? 0),
    },
  );

  return {
    month,
    daysThisMonth: daysInMonth(monthStartKey),
    monthName: monthName(monthStartKey),
    prevMonthName: monthName(prevMonthStartKey),
    families: {
      month: Number(familyRows[0]?.month ?? 0),
      prevSame: Number(familyRows[0]?.prev_same ?? 0),
      newMonth: Number(familyRows[0]?.month_new ?? 0),
    },
  };
}
