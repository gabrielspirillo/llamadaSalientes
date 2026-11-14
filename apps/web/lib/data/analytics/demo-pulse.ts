// Datos de muestra para "Ver ejemplo" del panel: fijos, sin base. Son los
// mismos componentes que ve una clínica real (tarjetas de arriba y bloques de
// negocio), con números verosímiles de una clínica pequeña.

import type { AgendaPulse } from '@/lib/data/analytics/agenda-pulse';
import type { BusinessPulse } from '@/lib/data/analytics/business-pulse';
import { daysInMonth, summarizeMonth } from '@/lib/data/analytics/month-model';
import { estimateSavings } from '@/lib/data/analytics/value-model';
import { addDaysToKey, localDateKey, weekdayOfKey } from '@/lib/tasks/tz';

const TZ = 'Europe/Madrid';

function monthName(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)).toLocaleDateString('es-ES', {
    month: 'long',
    timeZone: 'UTC',
  });
}

export function getDemoAgendaPulse(): AgendaPulse {
  return {
    today: { total: 9, confirmed: 7, pending: 2, nextTime: '17:30' },
    occupancy: { rate: 0.82, bookedMinutes: 1230, shiftMinutes: 1500 },
    assistant: {
      thisMonth: 64,
      lastMonth: 51,
      daily: [3, 5, 2, 6, 4, 0, 1, 5, 7, 4, 6, 3, 0, 2],
      monthBookings: 118,
      replies: 538,
      conversations: 91,
      offHours: 129,
    },
    savings: estimateSavings({ reply: 538, booking: 64, reminder: 96, offer: 31 }),
    recovered: {
      monthCents: 54_000,
      monthCount: 12,
      totalCents: 142_500,
      totalCount: 32,
      weekly: [9000, 13_500, 18_000, 4500, 22_500, 13_500, 27_000, 18_000],
    },
    lost: { rate: 0.06, lost: 7, total: 118 },
    firstVisits: 19,
    noShowSeries: [],
  };
}

export function getDemoBusinessPulse(): BusinessPulse {
  const todayKey = localDateKey(new Date(), TZ);
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const prevMonthStartKey = `${addDaysToKey(monthStartKey, -1).slice(0, 7)}-01`;
  const rows: { dayKey: string; cents: number; firstVisit: boolean }[] = [];
  const addMonth = (startKey: string, lastDay: number, perDay: number[]) => {
    for (let d = 0; d < lastDay; d++) {
      const dayKey = addDaysToKey(startKey, d);
      if (weekdayOfKey(dayKey) >= 6) continue;
      const n = perDay[d % perDay.length] ?? 8;
      for (let j = 0; j < n; j++) rows.push({ dayKey, cents: 4500, firstVisit: j === 0 });
    }
  };
  addMonth(prevMonthStartKey, daysInMonth(prevMonthStartKey), [8, 9, 7, 10, 8]);
  addMonth(monthStartKey, Number(todayKey.slice(8, 10)), [9, 11, 10, 12, 9]);
  const month = summarizeMonth(rows, {
    monthStartKey,
    prevMonthStartKey,
    todayKey,
    fallbackCents: 4500,
  });
  const families = Math.round(month.sessions.month * 0.62);
  return {
    month,
    daysThisMonth: daysInMonth(monthStartKey),
    monthName: monthName(monthStartKey),
    prevMonthName: monthName(prevMonthStartKey),
    families: {
      month: families,
      prevSame: Math.round(month.sessions.prevSame * 0.6),
      newMonth: month.firstVisits.month,
    },
  };
}
