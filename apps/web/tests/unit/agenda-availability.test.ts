import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  computeDaySlots,
  computeRangeSlots,
  describeConflict,
  groupSlotsByDay,
  isInsideWorkingHours,
  localHHMM,
  overlaps,
  shiftAppliesOn,
} from '@/lib/agenda/availability';
import { normalizePatientPhone, patientKeyFor } from '@/lib/agenda/patients';
import { hhmmToMinutes, minutesToHHMM } from '@/lib/agenda/shared';
import {
  computeDayWindow,
  toCalendarBlocks,
  toCalendarItems,
  weekDateKeys,
} from '@/lib/agenda/view';

const TZ = 'Europe/Madrid';

/** Horario tipo: mañana de 9 a 14 y tarde de 16 a 20, de lunes a viernes. */
function weekdayShifts() {
  return [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 14 * 60 },
    { weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
  ]);
}

const baseOptions = {
  timezone: TZ,
  durationMinutes: 30,
  granularityMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxAdvanceDays: 365,
  now: new Date('2026-09-01T00:00:00Z'),
};

describe('computeDaySlots', () => {
  it('genera los huecos de la franja y ninguno se sale de ella', () => {
    // Martes 8 de septiembre de 2026.
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: weekdayShifts(),
      appointments: [],
      blocks: [],
      options: baseOptions,
    });

    expect(slots.length).toBe(18); // 10 por la mañana + 8 por la tarde
    expect(localHHMM(slots[0]!.start, TZ)).toBe('09:00');
    // El último de la mañana empieza a las 13:30 y termina justo a las 14:00.
    expect(localHHMM(slots[9]!.start, TZ)).toBe('13:30');
    expect(localHHMM(slots[10]!.start, TZ)).toBe('16:00');
    const last = slots[slots.length - 1]!;
    expect(localHHMM(last.start, TZ)).toBe('19:30');
    expect(localHHMM(last.end, TZ)).toBe('20:00');
  });

  it('no ofrece un hueco que no cabe entero en la franja', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 10 * 60 }],
      appointments: [],
      blocks: [],
      options: { ...baseOptions, durationMinutes: 45, granularityMinutes: 30 },
    });
    // Sólo cabe el de las 9:00 (9:45 ≤ 10:00); el de las 9:30 se saldría.
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:00']);
  });

  it('el día que el profesional no trabaja no tiene huecos', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-13', // domingo
      shifts: weekdayShifts(),
      appointments: [],
      blocks: [],
      options: baseOptions,
    });
    expect(slots).toEqual([]);
  });

  it('una cita ocupa su hueco y libera el resto', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 }],
      appointments: [
        { start: new Date('2026-09-08T08:00:00Z'), end: new Date('2026-09-08T08:30:00Z') }, // 10:00 local
      ],
      blocks: [],
      options: baseOptions,
    });
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:00', '09:30', '10:30']);
  });

  it('el descanso entre citas se respeta a los dos lados', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 }],
      appointments: [
        { start: new Date('2026-09-08T08:00:00Z'), end: new Date('2026-09-08T08:30:00Z') }, // 10:00-10:30
      ],
      blocks: [],
      options: { ...baseOptions, bufferMinutes: 15 },
    });
    // Con 15 min de colchón, el de 09:30 (termina 10:00) y el de 10:30 caen.
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:00', '11:00', '11:30']);
  });

  it('un bloqueo tapa el rato, sin colchón', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 }],
      appointments: [],
      blocks: [
        { start: new Date('2026-09-08T07:00:00Z'), end: new Date('2026-09-08T08:00:00Z') }, // 09:00-10:00
      ],
      options: { ...baseOptions, bufferMinutes: 30 },
    });
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  it('la antelación mínima descarta lo que está demasiado cerca', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 }],
      appointments: [],
      blocks: [],
      options: {
        ...baseOptions,
        now: new Date('2026-09-08T07:30:00Z'), // 09:30 en Madrid
        minNoticeHours: 2,
      },
    });
    // 09:30 + 2 h = 11:30 → sólo entran 11:30 (y nada después, la franja acaba).
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['11:30']);
  });

  it('el tope de antelación descarta lo que está demasiado lejos', () => {
    const slots = computeRangeSlots({
      fromDateKey: '2026-09-08',
      toDateKey: '2026-09-30',
      shifts: weekdayShifts(),
      appointments: [],
      blocks: [],
      // El tope se mide como instante desde "ahora" (lunes 08:00 en Madrid),
      // no en días de calendario: el jueves a las 09:00 ya cae fuera.
      options: { ...baseOptions, maxAdvanceDays: 3, now: new Date('2026-09-07T06:00:00Z') },
    });
    const days = new Set(groupSlotsByDay(slots, TZ).map((g) => g.dateKey));
    expect([...days].sort()).toEqual(['2026-09-08', '2026-09-09']);
  });

  it('respeta la hora de pared al cambiar la hora (DST)', () => {
    // El 25 de octubre de 2026 España atrasa el reloj. La primera cita del
    // domingo tiene que seguir siendo a las 09:00 locales.
    const slots = computeDaySlots({
      dateKey: '2026-10-25',
      shifts: [{ weekday: 7, startMinute: 9 * 60, endMinute: 11 * 60 }],
      appointments: [],
      blocks: [],
      options: baseOptions,
    });
    expect(localHHMM(slots[0]!.start, TZ)).toBe('09:00');
    // …y en UTC eso ya es 08:00, no 07:00 como en verano.
    expect(slots[0]!.start.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('la vigencia de una franja acota los días en los que aplica', () => {
    const shift = {
      weekday: 2,
      startMinute: 9 * 60,
      endMinute: 12 * 60,
      validFrom: '2026-09-15',
      validUntil: '2026-09-30',
    };
    expect(shiftAppliesOn(shift, '2026-09-08')).toBe(false);
    expect(shiftAppliesOn(shift, '2026-09-15')).toBe(true);
    expect(shiftAppliesOn(shift, '2026-09-29')).toBe(true);
    expect(shiftAppliesOn(shift, '2026-10-06')).toBe(false);
  });

  it('sin rejilla, las citas van una detrás de otra', () => {
    // Es el modo por defecto: la duración la pone el tratamiento y el paso es
    // esa misma duración, así que el día se ordena solo.
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 12 * 60 }],
      appointments: [],
      blocks: [],
      options: { ...baseOptions, durationMinutes: 45, granularityMinutes: 0 },
    });
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });

  it('con rejilla, se ofrecen inicios intermedios para encajar citas cortas', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 }],
      appointments: [],
      blocks: [],
      options: { ...baseOptions, durationMinutes: 45, granularityMinutes: 15 },
    });
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
    ]);
  });

  it('con descanso 0 una cita queda pegada a la siguiente', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [{ weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 }],
      appointments: [
        { start: new Date('2026-09-08T07:00:00Z'), end: new Date('2026-09-08T07:30:00Z') }, // 09:00-09:30
      ],
      blocks: [],
      options: { ...baseOptions, bufferMinutes: 0 },
    });
    // El hueco de las 09:30 se ofrece: sin descanso, empieza justo al acabar.
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:30', '10:00', '10:30']);
  });

  it('dos franjas duplicadas no ofrecen el mismo hueco dos veces', () => {
    const slots = computeDaySlots({
      dateKey: '2026-09-08',
      shifts: [
        { weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 },
        { weekday: 2, startMinute: 9 * 60, endMinute: 11 * 60 },
      ],
      appointments: [],
      blocks: [],
      options: baseOptions,
    });
    expect(slots.map((s) => localHHMM(s.start, TZ))).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });
});

describe('isInsideWorkingHours', () => {
  const shifts = [{ weekday: 2, startMinute: 9 * 60, endMinute: 14 * 60 }];

  it('acepta lo que cabe dentro de la franja', () => {
    expect(
      isInsideWorkingHours(
        new Date('2026-09-08T08:00:00Z'), // 10:00
        new Date('2026-09-08T08:30:00Z'),
        shifts,
        TZ,
      ),
    ).toBe(true);
  });

  it('rechaza lo que se sale por el final', () => {
    expect(
      isInsideWorkingHours(
        new Date('2026-09-08T11:30:00Z'), // 13:30
        new Date('2026-09-08T12:30:00Z'), // 14:30
        shifts,
        TZ,
      ),
    ).toBe(false);
  });
});

describe('describeConflict', () => {
  it('distingue el choque con una cita del bloqueo', () => {
    const start = new Date('2026-09-08T08:00:00Z');
    const end = new Date('2026-09-08T08:30:00Z');

    expect(describeConflict(start, end, [{ start, end }], [])).toMatch(/se pisa con otra cita/);

    expect(describeConflict(start, end, [], [{ start, end }])).toMatch(/bloqueado/);

    expect(describeConflict(start, end, [], [])).toBeNull();
  });
});

describe('overlaps', () => {
  it('dos intervalos que se tocan por el borde no se solapan', () => {
    const a1 = new Date('2026-09-08T09:00:00Z');
    const a2 = new Date('2026-09-08T09:30:00Z');
    const b2 = new Date('2026-09-08T10:00:00Z');
    expect(overlaps(a1, a2, a2, b2)).toBe(false);
    expect(overlaps(a1, b2, a2, b2)).toBe(true);
  });
});

describe('patientKeyFor', () => {
  it('prioriza el id del CRM sobre el teléfono', () => {
    expect(patientKeyFor({ ghlContactId: 'abc123', phone: '+34600111222' })).toBe('ghl:abc123');
  });

  it('normaliza el teléfono para que el mismo paciente sea la misma clave', () => {
    expect(patientKeyFor({ phone: '+34 600 111 222' })).toBe('tel:+34600111222');
    expect(patientKeyFor({ phone: '0034600111222' })).toBe('tel:+34600111222');
    expect(patientKeyFor({ phone: '600111222' })).toBe('tel:+600111222');
  });

  it('cae al email y, en último extremo, al nombre', () => {
    expect(patientKeyFor({ email: 'Ana@Test.com' })).toBe('email:ana@test.com');
    expect(patientKeyFor({ name: 'Ana Pérez' })).toBe('anon:ana-perez');
    expect(patientKeyFor({})).toBe('anon:sin-datos');
  });

  it('rechaza teléfonos que no lo son', () => {
    expect(normalizePatientPhone('no tengo')).toBeNull();
    expect(normalizePatientPhone('')).toBeNull();
  });
});

describe('helpers de horas', () => {
  it('ida y vuelta entre minutos y HH:MM', () => {
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(minutesToHHMM(9 * 60 + 30)).toBe('09:30');
    expect(hhmmToMinutes('09:30')).toBe(570);
    expect(hhmmToMinutes('24:00')).toBe(1440);
    expect(hhmmToMinutes('nueve')).toBeNull();
  });
});

describe('modelo de vista del calendario', () => {
  const appointment = {
    id: 'a1',
    professionalId: 'p1',
    professionalName: 'Dra. Ruiz',
    professionalColor: '#37766a',
    patientName: 'Ana',
    patientKey: 'tel:+34600111222',
    patientPhone: '+34600111222',
    treatmentId: null,
    treatmentName: null,
    status: 'SCHEDULED' as const,
    source: 'PANEL' as const,
    notes: null,
    startsAt: new Date('2026-09-08T08:00:00Z'), // 10:00 en Madrid
    endsAt: new Date('2026-09-08T08:30:00Z'),
  };

  it('sitúa la cita en el día y el minuto locales de la clínica', () => {
    const items = toCalendarItems([appointment], ['2026-09-08'], TZ);
    expect(items).toHaveLength(1);
    expect(items[0]!.startMinute).toBe(600);
    expect(items[0]!.endMinute).toBe(630);
    expect(items[0]!.dateKey).toBe('2026-09-08');
  });

  it('una cita que cruza la medianoche se parte en dos días', () => {
    const items = toCalendarItems(
      [
        {
          ...appointment,
          startsAt: new Date('2026-09-08T21:30:00Z'), // 23:30
          endsAt: new Date('2026-09-08T22:30:00Z'), // 00:30 del día siguiente
        },
      ],
      ['2026-09-08', '2026-09-09'],
      TZ,
    );
    expect(items.map((i) => i.dateKey)).toEqual(['2026-09-09', '2026-09-08']);
    const primero = items.find((i) => i.dateKey === '2026-09-08')!;
    expect(primero.endMinute).toBe(1440);
    expect(primero.continuesAfter).toBe(true);
    const segundo = items.find((i) => i.dateKey === '2026-09-09')!;
    expect(segundo.startMinute).toBe(0);
    expect(segundo.continuesBefore).toBe(true);
  });

  it('un bloqueo de día completo se marca como tal', () => {
    const blocks = toCalendarBlocks(
      [
        {
          id: 'b1',
          professionalId: 'p1',
          kind: 'TIME_OFF',
          reason: 'Vacaciones',
          allDay: true,
          startsAt: new Date('2026-09-07T22:00:00Z'), // 00:00 del 8 en Madrid
          endsAt: new Date('2026-09-08T22:00:00Z'),
        },
      ],
      ['2026-09-08'],
      TZ,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.startMinute).toBe(0);
    expect(blocks[0]!.endMinute).toBe(1440);
    expect(blocks[0]!.allDay).toBe(true);
  });

  it('la ventana del calendario se estira para que se vea una urgencia de noche', () => {
    const window = computeDayWindow(
      [{ startMinute: 9 * 60, endMinute: 14 * 60 }],
      [{ startMinute: 21 * 60, endMinute: 22 * 60 }],
    );
    expect(window.startMinute).toBe(8 * 60);
    expect(window.endMinute).toBe(22 * 60);
  });

  it('la semana empieza en lunes', () => {
    // El 10 de septiembre de 2026 es jueves.
    expect(weekDateKeys('2026-09-10')[0]).toBe('2026-09-07');
    expect(weekDateKeys('2026-09-10')).toHaveLength(7);
    expect(weekDateKeys('2026-09-10')[6]).toBe('2026-09-13');
  });
});
