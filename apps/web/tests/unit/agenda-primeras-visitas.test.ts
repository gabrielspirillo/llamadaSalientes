import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type BookedInterval,
  computeDaySlots,
  describeFirstVisitConflict,
} from '@/lib/agenda/availability';
import { firstVisitRules, parseBookingPolicy } from '@/lib/care-profile/policy';
import { zonedToUtc } from '@/lib/tasks/tz';

/**
 * Las reglas de reserva de primeras visitas de una clínica pediátrica: no
 * encadenar más de dos pacientes nuevos y no darles hora los lunes y
 * miércoles desde las 19:00. Todo en hora local de Madrid.
 */

const TZ = 'Europe/Madrid';
// Lunes 5 de octubre de 2026.
const LUNES = '2026-10-05';
const MARTES = '2026-10-06';

function at(dateKey: string, hhmm: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return zonedToUtc(y ?? 2026, m ?? 1, d ?? 1, h ?? 0, min ?? 0, TZ);
}

function cita(dateKey: string, from: string, to: string, firstVisit: boolean): BookedInterval {
  return { start: at(dateKey, from), end: at(dateKey, to), firstVisit };
}

const rules = firstVisitRules(
  parseBookingPolicy({
    maxConsecutiveFirstVisits: 2,
    firstVisitBlackouts: [
      { weekday: 1, fromMinute: 1140 },
      { weekday: 3, fromMinute: 1140 },
    ],
  }),
);
if (!rules) throw new Error('la política de prueba tiene reglas');

describe('firstVisitRules', () => {
  it('sin reglas no hay nada que aplicar', () => {
    expect(firstVisitRules(parseBookingPolicy({}))).toBeNull();
    expect(firstVisitRules(parseBookingPolicy({ maxConsecutiveFirstVisits: 3 }))).toEqual({
      maxConsecutive: 3,
      blackouts: [],
    });
  });
});

describe('franjas sin primeras visitas', () => {
  it('el lunes a las 19:00 no, a las 18:15 sí; el martes a las 19:00 sí', () => {
    expect(
      describeFirstVisitConflict(at(LUNES, '19:00'), at(LUNES, '19:45'), [], rules, TZ),
    ).toMatch(/no da primeras visitas/);
    expect(
      describeFirstVisitConflict(at(LUNES, '18:15'), at(LUNES, '19:00'), [], rules, TZ),
    ).toBeNull();
    expect(
      describeFirstVisitConflict(at(MARTES, '19:00'), at(MARTES, '19:45'), [], rules, TZ),
    ).toBeNull();
  });
});

describe('no más de dos primeras visitas seguidas', () => {
  it('con dos primeras pegadas antes, la tercera no entra', () => {
    const agenda = [cita(MARTES, '09:00', '09:45', true), cita(MARTES, '09:45', '10:30', true)];
    expect(
      describeFirstVisitConflict(at(MARTES, '10:30'), at(MARTES, '11:15'), agenda, rules, TZ),
    ).toMatch(/haría 3/);
  });

  it('una de seguimiento en medio corta la cadena', () => {
    const agenda = [
      cita(MARTES, '09:00', '09:45', true),
      cita(MARTES, '09:45', '10:30', false),
      cita(MARTES, '10:30', '11:15', true),
    ];
    expect(
      describeFirstVisitConflict(at(MARTES, '11:15'), at(MARTES, '12:00'), agenda, rules, TZ),
    ).toBeNull();
  });

  it('un hueco libre en medio también la corta', () => {
    const agenda = [cita(MARTES, '09:00', '09:45', true), cita(MARTES, '09:45', '10:30', true)];
    // De 10:30 a 11:15 no hay nadie: cabe otra cita entre medio, no son seguidas.
    expect(
      describeFirstVisitConflict(at(MARTES, '11:15'), at(MARTES, '12:00'), agenda, rules, TZ),
    ).toBeNull();
  });

  it('se cuenta también hacia delante: entre dos primeras no cabe otra', () => {
    const agenda = [cita(MARTES, '09:00', '09:45', true), cita(MARTES, '10:30', '11:15', true)];
    expect(
      describeFirstVisitConflict(at(MARTES, '09:45'), at(MARTES, '10:30'), agenda, rules, TZ),
    ).toMatch(/haría 3/);
  });

  it('dos seguidas está permitido: gemelos en horas consecutivas', () => {
    const agenda = [cita(MARTES, '09:00', '09:45', true)];
    expect(
      describeFirstVisitConflict(at(MARTES, '09:45'), at(MARTES, '10:30'), agenda, rules, TZ),
    ).toBeNull();
  });

  it('sin tope de seguidas sólo aplican las franjas', () => {
    const soloFranjas = { maxConsecutive: null, blackouts: rules.blackouts };
    const agenda = [cita(MARTES, '09:00', '09:45', true), cita(MARTES, '09:45', '10:30', true)];
    expect(
      describeFirstVisitConflict(at(MARTES, '10:30'), at(MARTES, '11:15'), agenda, soloFranjas, TZ),
    ).toBeNull();
  });
});

describe('el motor de huecos aplica las reglas sólo a primeras visitas', () => {
  const shifts = [{ weekday: 1, startMinute: 9 * 60, endMinute: 21 * 60 }];
  const base = {
    timezone: TZ,
    durationMinutes: 45,
    granularityMinutes: 0,
    bufferMinutes: 0,
    minNoticeHours: 0,
    maxAdvanceDays: 90,
    now: at('2026-10-01', '08:00'),
  };
  const agenda = [cita(LUNES, '09:00', '09:45', true), cita(LUNES, '09:45', '10:30', true)];

  it('para una primera visita desaparecen el 10:30 (tercera seguida) y la tarde vetada', () => {
    const slots = computeDaySlots({
      dateKey: LUNES,
      shifts,
      appointments: agenda,
      blocks: [],
      options: { ...base, firstVisit: rules },
    });
    // Rejilla automática de 45 min desde las 9:00: …, 18:00, 18:45, 19:30, 20:15.
    const horas = slots.map((s) => s.start.toISOString());
    expect(horas).not.toContain(at(LUNES, '10:30').toISOString());
    expect(horas).toContain(at(LUNES, '11:15').toISOString());
    expect(horas).toContain(at(LUNES, '18:00').toISOString());
    // Empieza antes de las 19:00: todavía vale.
    expect(horas).toContain(at(LUNES, '18:45').toISOString());
    expect(horas).not.toContain(at(LUNES, '19:30').toISOString());
    expect(horas).not.toContain(at(LUNES, '20:15').toISOString());
  });

  it('para un paciente de seguimiento no cambia nada', () => {
    const slots = computeDaySlots({
      dateKey: LUNES,
      shifts,
      appointments: agenda,
      blocks: [],
      options: base,
    });
    const horas = slots.map((s) => s.start.toISOString());
    expect(horas).toContain(at(LUNES, '10:30').toISOString());
    expect(horas).toContain(at(LUNES, '19:30').toISOString());
    expect(horas).toContain(at(LUNES, '20:15').toISOString());
  });
});
