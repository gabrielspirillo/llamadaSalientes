import { describe, expect, it } from 'vitest';

import {
  describeRanges,
  fitsInRanges,
  hasAfternoon,
  hasMorning,
  normalizeRanges,
  parseClock,
  parseStoredRanges,
  specialDaysText,
} from '@/lib/agenda/special-days';

describe('días con horario especial: franjas', () => {
  it('lee horas', () => {
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('9:00')).toBe(540);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('ordena, junta las que se tocan y rechaza solapes', () => {
    const ok = normalizeRanges([
      { start: 900, end: 1200 },
      { start: 540, end: 780 },
    ]);
    expect(ok).toEqual({
      ok: true,
      ranges: [
        { start: 540, end: 780 },
        { start: 900, end: 1200 },
      ],
    });
    expect(
      normalizeRanges([
        { start: 540, end: 780 },
        { start: 780, end: 900 },
      ]),
    ).toEqual({ ok: true, ranges: [{ start: 540, end: 900 }] });
    const bad = normalizeRanges([
      { start: 540, end: 800 },
      { start: 780, end: 900 },
    ]);
    expect(bad.ok).toBe(false);
  });

  it('rechaza franjas vacías, al revés, demasiado cortas o demasiadas', () => {
    expect(normalizeRanges([]).ok).toBe(false);
    expect(normalizeRanges([{ start: 600, end: 540 }]).ok).toBe(false);
    expect(normalizeRanges([{ start: 600, end: 610 }]).ok).toBe(false);
    expect(
      normalizeRanges([
        { start: 480, end: 540 },
        { start: 600, end: 660 },
        { start: 720, end: 780 },
        { start: 900, end: 960 },
      ]).ok,
    ).toBe(false);
  });

  it('lo guardado roto no rompe nada', () => {
    expect(parseStoredRanges(null)).toEqual([]);
    expect(parseStoredRanges([{ start: 'x' }])).toEqual([]);
    expect(parseStoredRanges([{ start: 540, end: 780 }])).toEqual([{ start: 540, end: 780 }]);
  });

  it('mañana, tarde y si una cita cabe', () => {
    const ranges = [
      { start: 540, end: 780 },
      { start: 900, end: 1200 },
    ];
    expect(hasMorning(ranges)).toBe(true);
    expect(hasAfternoon(ranges)).toBe(true);
    expect(hasAfternoon([{ start: 540, end: 780 }])).toBe(false);
    expect(fitsInRanges(570, 600, ranges)).toBe(true);
    // Una cita que cruza la pausa del mediodía no cabe.
    expect(fitsInRanges(765, 795, ranges)).toBe(false);
  });

  it('texto para los asistentes', () => {
    expect(
      describeRanges([
        { start: 540, end: 780 },
        { start: 900, end: 1200 },
      ]),
    ).toBe('de 9:00 a 13:00 y de 15:00 a 20:00');
    const text = specialDaysText(
      [
        { day: '2026-11-21', ranges: [{ start: 540, end: 780 }] },
        { day: '2026-11-10', ranges: [{ start: 540, end: 780 }] },
      ],
      '2026-11-13',
    );
    expect(text).toContain('sábado 21 de noviembre: de 9:00 a 13:00');
    // Los pasados no salen.
    expect(text).not.toContain('10 de noviembre');
    expect(specialDaysText([], '2026-11-13')).toBe('');
  });
});

import { computeDaySlots, isInsideWorkingHours, shiftsForDate } from '@/lib/agenda/availability';

describe('motor de huecos con días especiales', () => {
  const tz = 'Europe/Madrid';
  // Horario semanal de Raquel: L-V de 15:00 a 20:00.
  const weekly = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 900,
    endMinute: 1200,
  }));
  const options = {
    timezone: tz,
    durationMinutes: 30,
    granularityMinutes: 0,
    bufferMinutes: 0,
    minNoticeHours: 0,
    maxAdvanceDays: 400,
    now: new Date('2026-11-13T08:00:00Z'),
  };
  const hhmm = (d: Date) =>
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  it('un día especial sustituye el horario de ese día; los demás, igual', () => {
    const special = [
      { weekday: 5, startMinute: 540, endMinute: 780, date: '2026-11-20' },
      { weekday: 5, startMinute: 900, endMinute: 1200, date: '2026-11-20' },
    ];
    const rules = [...weekly, ...special];
    expect(shiftsForDate(rules, '2026-11-20')).toHaveLength(2);
    expect(shiftsForDate(rules, '2026-11-27')).toHaveLength(1);
    const slots = computeDaySlots({
      dateKey: '2026-11-20',
      shifts: rules,
      appointments: [],
      blocks: [],
      options,
    }).map((s) => hhmm(s.start));
    expect(slots[0]).toBe('09:00');
    expect(slots).toContain('12:30');
    expect(slots).not.toContain('13:00');
    expect(slots).toContain('15:00');
    expect(slots).not.toContain('14:00');
  });

  it('sólo mañana: esa tarde no se ofrece', () => {
    const rules = [...weekly, { weekday: 5, startMinute: 540, endMinute: 780, date: '2026-11-20' }];
    const slots = computeDaySlots({
      dateKey: '2026-11-20',
      shifts: rules,
      appointments: [],
      blocks: [],
      options,
    }).map((s) => hhmm(s.start));
    expect(slots).not.toContain('15:00');
    expect(slots[slots.length - 1]).toBe('12:30');
  });

  it('abre un sábado que normalmente no trabaja', () => {
    const rules = [...weekly, { weekday: 6, startMinute: 600, endMinute: 720, date: '2026-11-21' }];
    const slots = computeDaySlots({
      dateKey: '2026-11-21',
      shifts: rules,
      appointments: [],
      blocks: [],
      options,
    });
    expect(slots).toHaveLength(4);
    expect(
      computeDaySlots({
        dateKey: '2026-11-28',
        shifts: rules,
        appointments: [],
        blocks: [],
        options,
      }),
    ).toHaveLength(0);
  });

  it('una cita a las 10:00 de ese día está dentro de horario; a las 14:00, no', () => {
    const rules = [
      ...weekly,
      { weekday: 5, startMinute: 540, endMinute: 780, date: '2026-11-20' },
      { weekday: 5, startMinute: 900, endMinute: 1200, date: '2026-11-20' },
    ];
    const at = (h: number) => new Date(Date.UTC(2026, 10, 20, h - 1, 0));
    const plus30 = (d: Date) => new Date(d.getTime() + 30 * 60_000);
    expect(isInsideWorkingHours(at(10), plus30(at(10)), rules, tz)).toBe(true);
    expect(isInsideWorkingHours(at(14), plus30(at(14)), rules, tz)).toBe(false);
    expect(isInsideWorkingHours(at(16), plus30(at(16)), rules, tz)).toBe(true);
    // Otro viernes, sin día especial: la mañana no.
    const other = new Date(Date.UTC(2026, 10, 27, 9, 0));
    expect(isInsideWorkingHours(other, plus30(other), rules, tz)).toBe(false);
  });
});
