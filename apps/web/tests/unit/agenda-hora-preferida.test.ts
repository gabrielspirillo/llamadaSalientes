import { describe, expect, it } from 'vitest';

import {
  parsePreferredTime,
  rankByPreferredTime,
  startsAtMinute,
} from '@/lib/agenda/preferred-time';

const tz = 'Europe/Madrid';
// Noviembre: Madrid = UTC+1.
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { start: new Date(Date.UTC(2026, 10, day, (h ?? 0) - 1, m ?? 0)) };
};

describe('hora preferida en la búsqueda de huecos', () => {
  it('entiende 16:30, 16.30, 16h30 y 16', () => {
    expect(parsePreferredTime('16:30')).toBe(990);
    expect(parsePreferredTime('16.30')).toBe(990);
    expect(parsePreferredTime('16h30')).toBe(990);
    expect(parsePreferredTime('16')).toBe(960);
    expect(parsePreferredTime('por la tarde')).toBeNull();
    expect(parsePreferredTime('25:00')).toBeNull();
  });

  it('13/11: con "sobre las 16:30" el viernes 20 a las 16:30 sale el primero', () => {
    // Lo que devolvía la agenda compacta: primero los pegados a citas.
    const options = [
      at(17, '15:00'),
      at(19, '18:00'),
      at(20, '17:30'),
      at(20, '19:30'),
      at(20, '16:30'),
      at(20, '16:00'),
    ];
    const ranked = rankByPreferredTime(options, tz, 990);
    expect(startsAtMinute(ranked[0]!.start, tz, 990)).toBe(true);
    expect(ranked[0]!.start.getUTCDate()).toBe(20);
    // Después lo más cercano a esa hora: 16:00 (media hora) y 17:30 (una hora).
    expect(
      ranked.slice(0, 3).map((o) => (o.start.getUTCHours() + 1) * 60 + o.start.getUTCMinutes()),
    ).toEqual([990, 960, 1050]);
  });
});
