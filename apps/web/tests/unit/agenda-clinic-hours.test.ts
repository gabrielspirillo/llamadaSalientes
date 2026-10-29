import { describe, expect, it } from 'vitest';

import { withinClinicHours } from '@/lib/agenda/clinic-hours';

const TZ = 'Europe/Madrid';
const hours = {
  monday: { open: '15:00', close: '20:30' },
  tuesday: { open: '15:00', close: '20:30' },
  saturday: null,
};

describe('withinClinicHours', () => {
  it('acepta una cita dentro del horario y rechaza la que se sale', () => {
    // Lunes 2 nov 2026, 16:00 Madrid = 15:00 UTC
    const start = new Date('2026-11-02T15:00:00Z');
    expect(withinClinicHours(start, new Date('2026-11-02T15:45:00Z'), TZ, hours)).toBe(true);
    // 20:00 + 45 min acaba a las 20:45: fuera.
    expect(
      withinClinicHours(
        new Date('2026-11-02T19:00:00Z'),
        new Date('2026-11-02T19:45:00Z'),
        TZ,
        hours,
      ),
    ).toBe(false);
    // 14:30: antes de abrir.
    expect(
      withinClinicHours(
        new Date('2026-11-02T13:30:00Z'),
        new Date('2026-11-02T14:15:00Z'),
        TZ,
        hours,
      ),
    ).toBe(false);
  });

  it('un día cerrado o no listado no tiene huecos', () => {
    expect(
      withinClinicHours(
        new Date('2026-11-07T15:00:00Z'),
        new Date('2026-11-07T15:45:00Z'),
        TZ,
        hours,
      ),
    ).toBe(false);
    expect(
      withinClinicHours(
        new Date('2026-11-04T15:00:00Z'),
        new Date('2026-11-04T15:45:00Z'),
        TZ,
        hours,
      ),
    ).toBe(false);
  });

  it('sin horario cargado no restringe', () => {
    const s = new Date('2026-11-07T15:00:00Z');
    expect(withinClinicHours(s, new Date('2026-11-07T15:45:00Z'), TZ, null)).toBe(true);
    expect(withinClinicHours(s, new Date('2026-11-07T15:45:00Z'), TZ, {})).toBe(true);
  });

  it('respeta el cambio de hora (29 de marzo de 2026, Madrid pasa a UTC+2)', () => {
    // Lunes 30 mar 2026 15:00 Madrid = 13:00 UTC
    expect(
      withinClinicHours(
        new Date('2026-03-30T13:00:00Z'),
        new Date('2026-03-30T13:45:00Z'),
        TZ,
        hours,
      ),
    ).toBe(true);
  });
});
