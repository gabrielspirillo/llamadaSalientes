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

  it('uno por arriba y uno por abajo, los más pegados', () => {
    const out = compactSlots(free, busy, TZ, 120);
    // Por arriba (antes de la última cita), el más pegado: 15:30, justo tras
    // la de las 15:00. Por abajo (tras la última, 18:30-19:00): 19:00.
    expect(out.slice(0, 2).map((s) => s.start.getTime())).toEqual(
      [at(15, 30), at(19)].map((d) => d.getTime()),
    );
  });

  it('dos de cada día primero, luego el resto', () => {
    const otroDia = (h: number) => ({
      start: new Date(at(h).getTime() + 86_400_000),
      end: new Date(at(h).getTime() + 86_400_000 + 30 * 60_000),
      professionalId: 'raquel',
    });
    const out = compactSlots([...free, otroDia(16), otroDia(17)], busy, TZ, 120);
    // Día 5: dos; día 6 (sin citas): dos; luego el resto del día 5.
    expect(out[2]?.start.getTime()).toBe(otroDia(16).start.getTime());
    expect(out[3]?.start.getTime()).toBe(otroDia(17).start.getTime());
  });

  it('un día sin citas, o de otro profesional, no se toca', () => {
    const otro = [slot(10, 0, 'ana'), slot(21, 0, 'ana')];
    expect(compactSlots(otro, busy, TZ, 120)).toHaveLength(2);
  });
});

describe('día con horario especial: mañana y tarde son bloques aparte', () => {
  // Día especial de 9:00 a 13:00 y de 15:00 a 20:00; citas sólo por la tarde.
  const segment = (_p: string, _d: string, minute: number) => (minute < 14 * 60 ? 'm' : 't');
  const busy = [slot(17), slot(17, 30)];
  const free = [slot(9), slot(9, 30), slot(10), slot(12, 30), slot(15), slot(16, 30), slot(18)];

  it('las citas de la tarde no hacen desaparecer la mañana', () => {
    const out = compactSlots(free, busy, TZ, 120, segment).map((s) => s.start.getTime());
    expect(out).toContain(at(9).getTime());
    expect(out).toContain(at(12, 30).getTime());
  });

  it('lo primero de ese día: lo mejor de la mañana y lo mejor de la tarde', () => {
    const out = compactSlots(free, busy, TZ, 120, segment);
    const first = out.slice(0, 2).map((s) => s.start.getTime());
    // Mañana sin citas: por orden de hora (9:00). Tarde: el más pegado (16:30).
    expect(first).toEqual([at(9), at(16, 30)].map((d) => d.getTime()));
  });

  it('sin bloques, igual que siempre', () => {
    const out = compactSlots(free, busy, TZ, 120).map((s) => s.start.getTime());
    expect(out).not.toContain(at(9).getTime());
  });
});
