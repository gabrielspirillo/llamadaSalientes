import { describe, expect, it } from 'vitest';

import { matchRequestedSlot } from '@/lib/agenda/slot-match';

const TZ = 'Europe/Madrid';
// Martes 3 nov 2026 (invierno, UTC+1): huecos libres 16:00 y 16:30 de Madrid.
const free = [new Date('2026-11-03T15:00:00Z'), new Date('2026-11-03T15:30:00Z')];

describe('matchRequestedSlot', () => {
  it('la hora local sin zona es la de la clínica', () => {
    const r = matchRequestedSlot('2026-11-03 16:00', TZ, free);
    expect(r.start?.toISOString()).toBe('2026-11-03T15:00:00.000Z');
    expect(r.dayKey).toBe('2026-11-03');
  });

  it('un ISO en UTC de los de antes se respeta si su hora de pared no es un hueco', () => {
    const r = matchRequestedSlot('2026-11-03T15:30:00.000Z', TZ, free);
    expect(r.start?.toISOString()).toBe('2026-11-03T15:30:00.000Z');
  });

  it('con Z y las dos lecturas libres, gana la hora de pared (lo que dijo el paciente)', () => {
    // Libres 15:00 y 16:00 de Madrid; el modelo manda "15:00Z" queriendo las 15:00.
    const both = [new Date('2026-11-03T14:00:00Z'), new Date('2026-11-03T15:00:00Z')];
    expect(matchRequestedSlot('2026-11-03T15:00:00Z', TZ, both).start?.toISOString()).toBe(
      '2026-11-03T14:00:00.000Z',
    );
  });

  it('"16:00Z" (hora local con Z) se corrige a las 16:00 de Madrid, no a las 17:00', () => {
    const r = matchRequestedSlot('2026-11-03T16:00:00Z', TZ, free);
    expect(r.start?.toISOString()).toBe('2026-11-03T15:00:00.000Z');
  });

  it('una hora que no está libre no se reserva y dice qué día listar', () => {
    const r = matchRequestedSlot('2026-11-03 18:00', TZ, free);
    expect(r.start).toBeNull();
    expect(r.dayKey).toBe('2026-11-03');
  });

  it('en verano (UTC+2) también', () => {
    const summer = [new Date('2026-06-02T14:00:00Z')]; // 16:00 Madrid
    expect(matchRequestedSlot('2026-06-02T16:00:00Z', TZ, summer).start?.toISOString()).toBe(
      '2026-06-02T14:00:00.000Z',
    );
  });
});
