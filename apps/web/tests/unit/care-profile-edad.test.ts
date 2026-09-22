import { describe, expect, it } from 'vitest';

import {
  EMPTY_BOOKING_POLICY,
  ageAt,
  describeAge,
  describeAgeRange,
  describeAnamnesis,
  describeGuardians,
  isFirstVisitBlackout,
  isPatientAgeAllowed,
  parseAnamnesisTemplate,
  parseBookingPolicy,
  priorityLevel,
} from '@/lib/care-profile/policy';

/**
 * El perfil de atención de una clínica pediátrica: la edad con número, quién
 * es prioritario y qué huecos no se dan a pacientes nuevos. Todo puro.
 */

describe('la edad con número', () => {
  it('"1 año y 8 meses", como la pide la clínica', () => {
    expect(describeAge('2024-01-15', '2025-09-22')).toBe('1 año y 8 meses');
  });

  it('antes del año se cuenta en meses; antes del mes, en días', () => {
    expect(describeAge('2026-02-10', '2026-09-22')).toBe('7 meses');
    expect(describeAge('2026-08-22', '2026-09-22')).toBe('1 mes');
    expect(describeAge('2026-09-10', '2026-09-22')).toBe('12 días');
    expect(describeAge('2026-09-22', '2026-09-22')).toBe('0 días');
  });

  it('un año justo no arrastra meses', () => {
    expect(describeAge('2024-09-22', '2026-09-22')).toBe('2 años');
    expect(describeAge('2025-09-22', '2026-09-22')).toBe('1 año');
  });

  it('el mes no se cumple hasta que llega el día', () => {
    // Nació un 31: el 30 del mes siguiente todavía no tiene un mes.
    expect(ageAt('2026-01-31', '2026-02-28')?.totalMonths).toBe(0);
    expect(ageAt('2026-01-31', '2026-03-01')?.totalMonths).toBe(1);
    expect(ageAt('2026-01-15', '2026-02-14')?.totalMonths).toBe(0);
    expect(ageAt('2026-01-15', '2026-02-15')?.totalMonths).toBe(1);
  });

  it('una fecha futura o inválida no es una edad', () => {
    expect(describeAge('2026-10-01', '2026-09-22')).toBeNull();
    expect(describeAge('no-es-fecha', '2026-09-22')).toBeNull();
    expect(describeAge('2026-01-01', '')).toBeNull();
  });
});

describe('las reglas de reserva', () => {
  const policy = parseBookingPolicy({
    maxConsecutiveFirstVisits: 2,
    firstVisitBlackouts: [
      { weekday: 1, fromMinute: 1140 },
      { weekday: 3, fromMinute: 1140, toMinute: 1440 },
    ],
    patientAgeMonths: { min: 0, max: 59 },
    priorityAgeMonths: { veryHighMax: 6, highMax: 24 },
  });

  it('una fila vacía o rota se lee como "sin reglas", nunca tumba la agenda', () => {
    expect(parseBookingPolicy(null)).toEqual(EMPTY_BOOKING_POLICY);
    expect(parseBookingPolicy({})).toEqual(EMPTY_BOOKING_POLICY);
    expect(parseBookingPolicy({ maxConsecutiveFirstVisits: -3 })).toEqual(EMPTY_BOOKING_POLICY);
    expect(parseBookingPolicy('basura')).toEqual(EMPTY_BOOKING_POLICY);
    expect(EMPTY_BOOKING_POLICY.firstVisitBlackouts).toEqual([]);
    expect(EMPTY_BOOKING_POLICY.patientAgeMonths).toEqual({ min: 0, max: null });
  });

  it('las claves que faltan toman el valor por defecto', () => {
    expect(policy.fastingHours).toBeNull();
    expect(policy.siblingsConsecutive).toBe(false);
    expect(policy.firstVisitBlackouts[0]?.toMinute).toBe(1440);
  });

  it('los lunes y miércoles desde las 19:00 no hay primeras visitas', () => {
    expect(isFirstVisitBlackout(1, 1140, policy)).toBe(true);
    expect(isFirstVisitBlackout(1, 1200, policy)).toBe(true);
    expect(isFirstVisitBlackout(1, 1139, policy)).toBe(false);
    expect(isFirstVisitBlackout(3, 1170, policy)).toBe(true);
    expect(isFirstVisitBlackout(2, 1200, policy)).toBe(false);
    expect(isFirstVisitBlackout(1, 1200, EMPTY_BOOKING_POLICY)).toBe(false);
  });

  it('sólo se atiende de 0 a 4 años incluidos', () => {
    expect(isPatientAgeAllowed(0, policy)).toBe(true);
    expect(isPatientAgeAllowed(59, policy)).toBe(true);
    expect(isPatientAgeAllowed(60, policy)).toBe(false);
    expect(isPatientAgeAllowed(200, EMPTY_BOOKING_POLICY)).toBe(true);
    expect(describeAgeRange(policy)).toBe('de 0 a 4 años');
    expect(describeAgeRange(EMPTY_BOOKING_POLICY)).toBeNull();
  });

  it('la prioridad sale de la edad y de la marca, y la marca nunca baja la de la edad', () => {
    expect(priorityLevel({ ageMonths: 0, priorityFlag: false }, policy)).toBe('VERY_HIGH');
    expect(priorityLevel({ ageMonths: 6, priorityFlag: false }, policy)).toBe('VERY_HIGH');
    expect(priorityLevel({ ageMonths: 7, priorityFlag: false }, policy)).toBe('HIGH');
    expect(priorityLevel({ ageMonths: 24, priorityFlag: false }, policy)).toBe('HIGH');
    expect(priorityLevel({ ageMonths: 25, priorityFlag: false }, policy)).toBe('NORMAL');
    expect(priorityLevel({ ageMonths: 40, priorityFlag: true }, policy)).toBe('HIGH');
    expect(priorityLevel({ ageMonths: 2, priorityFlag: true }, policy)).toBe('VERY_HIGH');
    expect(priorityLevel({ ageMonths: null, priorityFlag: false }, policy)).toBe('NORMAL');
    // Sin regla de edad, sólo cuenta la marca manual.
    expect(priorityLevel({ ageMonths: 1, priorityFlag: false }, EMPTY_BOOKING_POLICY)).toBe(
      'NORMAL',
    );
  });
});

describe('tutores y anamnesis', () => {
  it('mamá y papá, o "no hay" para una familia monomarental', () => {
    expect(
      describeGuardians([
        { role: 'MADRE', name: 'Laura' },
        { role: 'PADRE', name: 'Iván' },
      ]),
    ).toBe('Mamá: Laura · Papá: Iván');
    expect(
      describeGuardians([
        { role: 'MADRE', name: 'Laura' },
        { role: 'NINGUNO', name: '' },
      ]),
    ).toBe('Mamá: Laura · No hay');
  });

  it('la anamnesis se cuenta sólo con lo contestado', () => {
    const template = parseAnamnesisTemplate([
      { key: 'prematuro', label: 'Prematuro' },
      { key: 'alergias', label: 'Alergias' },
      { key: 'rge', label: 'RGE' },
    ]);
    expect(template).toHaveLength(3);
    expect(
      describeAnamnesis(template, {
        prematuro: { value: true, detail: '34 semanas' },
        alergias: { value: false, detail: '' },
        rge: { value: null, detail: '' },
      }),
    ).toBe('Prematuro: sí (34 semanas) · Alergias: no');
    expect(describeAnamnesis(template, {})).toBe('');
  });

  it('una plantilla mal formada se ignora entera', () => {
    expect(parseAnamnesisTemplate([{ key: 'Con Mayúsculas', label: 'x' }])).toEqual([]);
    expect(parseAnamnesisTemplate('no')).toEqual([]);
  });
});
