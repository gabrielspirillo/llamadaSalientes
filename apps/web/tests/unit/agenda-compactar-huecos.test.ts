import { describe, expect, it } from 'vitest';

import { compactSlots } from '@/lib/agenda/compact';

const TZ = 'Europe/Madrid';
// 5 de noviembre de 2026 (invierno: Madrid = UTC+1)
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 5, h - 1, m));
const slot = (h: number, m = 0, p = 'raquel') => ({
  start: at(h, m),
  end: new Date(at(h, m).getTime() + 30 * 60_000),
  professionalId: p,
});

describe('huecos compactos alrededor de las citas del día', () => {
  const busy = [slot(15), slot(18), slot(18, 30)];
  const free = [
    slot(12),
    slot(13),
    slot(15, 30),
    slot(16),
    slot(17),
    slot(17, 30),
    slot(19),
    slot(20, 30),
    slot(21),
  ];

  it('quita lo que queda a más de 2 h de la primera o la última cita', () => {
    const out = compactSlots(free, busy, TZ, 120).map((s) => s.start.getTime());
    expect(out).not.toContain(at(12).getTime());
    expect(out).not.toContain(at(21).getTime());
    expect(out).toContain(at(13).getTime());
    expect(out).toContain(at(20, 30).getTime());
  });

  it('primero los huecos pegados a una cita', () => {
    const out = compactSlots(free, busy, TZ, 120);
    const firstThree = out.slice(0, 3).map((s) => s.start.getTime());
    expect(firstThree).toEqual([at(15, 30), at(17, 30), at(19)].map((d) => d.getTime()));
  });

  it('un día sin citas, o de otro profesional, no se toca', () => {
    const otro = [slot(10, 0, 'ana'), slot(21, 0, 'ana')];
    expect(compactSlots(otro, busy, TZ, 120)).toHaveLength(2);
  });
});
