import { describe, expect, it } from 'vitest';

import {
  buildWeekStrip,
  changePct,
  daysInMonth,
  freeMinutes,
  ringProgress,
  summarizeMonth,
} from '@/lib/data/analytics/month-model';
import { weekdayOfKey } from '@/lib/tasks/tz';

describe('panel: el mes frente al anterior', () => {
  const opts = {
    monthStartKey: '2026-11-01',
    prevMonthStartKey: '2026-10-01',
    todayKey: '2026-11-14',
    fallbackCents: 4000,
  };

  it('compara con el mismo punto del mes anterior y con el mes entero', () => {
    const m = summarizeMonth(
      [
        { dayKey: '2026-10-02', cents: 4500, firstVisit: true },
        { dayKey: '2026-10-14', cents: 4500, firstVisit: false },
        { dayKey: '2026-10-20', cents: null, firstVisit: true },
        { dayKey: '2026-11-03', cents: 4500, firstVisit: true },
        { dayKey: '2026-11-03', cents: 0, firstVisit: false },
        { dayKey: '2026-11-13', cents: 5000, firstVisit: false },
      ],
      opts,
    );
    expect(m.sessions).toEqual({ month: 3, prevSame: 2, prevTotal: 3 });
    expect(m.firstVisits).toEqual({ month: 1, prevSame: 1, prevTotal: 2 });
    expect(m.revenue.monthCents).toBe(4500 + 4000 + 5000);
    expect(m.revenue.prevSameCents).toBe(9000);
    expect(m.revenue.prevTotalCents).toBe(13000);
    expect(m.revenue.cumThis).toHaveLength(14);
    expect(m.revenue.cumPrev).toHaveLength(31);
    expect(m.revenue.cumThis[2]).toBe(8500);
  });

  it('ignora lo de después de hoy y lo de hace dos meses', () => {
    const m = summarizeMonth(
      [
        { dayKey: '2026-11-20', cents: 4500, firstVisit: false },
        { dayKey: '2026-09-30', cents: 4500, firstVisit: false },
      ],
      opts,
    );
    expect(m.sessions).toEqual({ month: 0, prevSame: 0, prevTotal: 0 });
    expect(m.revenue.monthCents).toBe(0);
  });

  it('el 31 de un mes se compara con el último día de un mes corto', () => {
    const m = summarizeMonth([{ dayKey: '2026-11-30', cents: 1000, firstVisit: false }], {
      monthStartKey: '2026-12-01',
      prevMonthStartKey: '2026-11-01',
      todayKey: '2026-12-31',
      fallbackCents: 0,
    });
    expect(m.revenue.prevSameCents).toBe(1000);
    expect(daysInMonth('2026-02-01')).toBe(28);
  });

  it('variación y anillos', () => {
    expect(changePct(112, 100)).toBe(12);
    expect(changePct(5, 0)).toBeNull();
    expect(ringProgress(50, 200)).toBe(0.25);
    expect(ringProgress(300, 200)).toBe(1);
    expect(ringProgress(3, 0)).toBe(1);
    expect(ringProgress(0, 0)).toBe(0);
  });
});

describe('panel: la semana que viene', () => {
  const dayKeys = ['2026-11-16', '2026-11-17', '2026-11-21', '2026-11-22'];
  const shifts = [1, 2, 3, 4, 5].map((weekday) => ({
    professionalId: 'p1',
    weekday,
    startMinute: 900,
    endMinute: 1200,
  }));

  it('citas, horario, primera hora y días cerrados', () => {
    const week = buildWeekStrip({
      dayKeys,
      weekdayOf: weekdayOfKey,
      appointments: [
        { dayKey: '2026-11-16', startMinute: 960, minutes: 30, firstVisit: false },
        { dayKey: '2026-11-16', startMinute: 900, minutes: 30, firstVisit: true },
      ],
      shifts,
      specials: new Map([['p1|2026-11-21', [{ start: 540, end: 780 }]]]),
    });
    expect(week[0]).toMatchObject({
      letter: 'L',
      dayNumber: 16,
      count: 2,
      firstVisits: 1,
      bookedMinutes: 60,
      shiftMinutes: 300,
      firstTime: '15:00',
      closed: false,
    });
    // El sábado abre por un día especial.
    expect(week[2]).toMatchObject({ letter: 'S', shiftMinutes: 240, closed: false });
    expect(week[3]).toMatchObject({ letter: 'D', closed: true, firstTime: null });
    expect(freeMinutes(week)).toBe(240 + 300 + 240);
  });
});
