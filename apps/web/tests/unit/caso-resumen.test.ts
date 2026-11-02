import { describe, expect, it } from 'vitest';

import { buildCaseSummary } from '@/lib/patients/case-summary';

const base = {
  firstName: 'Leo',
  age: '1 año y 8 meses',
  priority: 'Prioritario por edad',
  medication: { state: 'TAKES' as const, text: 'Ventolín 2 puffs/12 h' },
  watchouts: ['Prematuro: 34 semanas'],
  reviewReason: null,
  needsReview: false,
  family: null,
  guardians: ['Mamá Laura · 600 11 22 33', 'Papá Iván · 611 22 33 44'],
  sessionsDone: 3,
  lastSession: {
    when: '28 oct',
    diagnosis: 'Bronquiolitis leve',
    nextSteps: 'Revisar en 1 semana',
  },
  nextAppointment: 'mar, 4 nov, 17:00',
  redFlags: null,
  hesitant: null,
  consentPending: true,
  pendingCharges: 1,
  anamnesisPending: 0,
};

describe('resumen del caso', () => {
  it('titular con nombre, edad, prioridad y sesiones', () => {
    expect(buildCaseSummary(base).headline).toBe(
      'Leo · 1 año y 8 meses · prioritario por edad — 3 sesiones, la última el 28 oct.',
    );
  });

  it('primero lo que hace daño olvidar: aviso, medicación, alertas', () => {
    const kinds = buildCaseSummary({ ...base, needsReview: true }).points.map((p) => p.kind);
    expect(kinds.slice(0, 3)).toEqual(['review', 'medication', 'watchouts']);
    expect(kinds).toContain('guardians');
    expect(kinds.at(-1)).toBe('pending');
  });

  it('sin visitas ni cita lo dice', () => {
    const s = buildCaseSummary({
      ...base,
      sessionsDone: 0,
      lastSession: null,
      nextAppointment: null,
    });
    expect(s.headline).toContain('aún no ha venido');
    expect(s.points.find((p) => p.kind === 'next')?.text).toBe('Sin cita reservada');
  });
});
