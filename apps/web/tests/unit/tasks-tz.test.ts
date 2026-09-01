import { describe, expect, it } from 'vitest';

import {
  addDaysToKey,
  daysBetweenKeys,
  localDateKey,
  parseTimeOfDay,
  weekdayOfKey,
  zonedToUtc,
} from '@/lib/tasks/tz';

describe('zonedToUtc', () => {
  it('respeta el horario de verano de Madrid (UTC+2)', () => {
    const d = zonedToUtc(2026, 7, 15, 8, 30, 'Europe/Madrid');
    expect(d.toISOString()).toBe('2026-07-15T06:30:00.000Z');
  });

  it('respeta el horario de invierno de Madrid (UTC+1)', () => {
    const d = zonedToUtc(2026, 1, 15, 8, 30, 'Europe/Madrid');
    expect(d.toISOString()).toBe('2026-01-15T07:30:00.000Z');
  });

  it('funciona con zonas al oeste de UTC', () => {
    const d = zonedToUtc(2026, 1, 15, 9, 0, 'America/Mexico_City');
    expect(d.toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });
});

describe('localDateKey', () => {
  it('usa el día local, no el UTC', () => {
    // 23:30 UTC del 31 de agosto ya es 1 de septiembre en Madrid (UTC+2).
    const d = new Date('2026-08-31T23:30:00.000Z');
    expect(localDateKey(d, 'Europe/Madrid')).toBe('2026-09-01');
    expect(localDateKey(d, 'UTC')).toBe('2026-08-31');
  });
});

describe('helpers de claves de fecha', () => {
  it('suma días cruzando el fin de mes', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('cuenta días entre claves', () => {
    expect(daysBetweenKeys('2026-09-01', '2026-09-10')).toBe(9);
    expect(daysBetweenKeys('2026-09-10', '2026-09-01')).toBe(-9);
  });

  it('devuelve el día ISO de la semana', () => {
    expect(weekdayOfKey('2026-09-01')).toBe(2); // martes
    expect(weekdayOfKey('2026-09-06')).toBe(7); // domingo
  });
});

describe('parseTimeOfDay', () => {
  it('parsea HH:MM y cae en 09:00 ante basura', () => {
    expect(parseTimeOfDay('08:30')).toEqual({ hour: 8, minute: 30 });
    expect(parseTimeOfDay('')).toEqual({ hour: 9, minute: 0 });
    expect(parseTimeOfDay('no es una hora')).toEqual({ hour: 9, minute: 0 });
  });
});
