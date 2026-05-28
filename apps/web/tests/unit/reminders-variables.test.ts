import { describe, expect, it } from 'vitest';

import { buildReminderVars, interpolate, resolveVar } from '@/lib/reminders/variables';

const baseInput = {
  appointmentStartTime: new Date('2026-05-26T08:30:00Z'), // 10:30 Madrid (UTC+2 mayo)
  appointmentDurationMinutes: 45,
  treatmentName: 'Limpieza dental',
  contactFirstName: 'María',
  contactLastName: 'Pérez',
  contactPhoneE164: '+34911234567',
  clinicName: 'Clínica Sonrisa',
  clinicAddress: 'Calle Mayor 12, Madrid',
  clinicPhone: '+34911000000',
  clinicTimezone: 'Europe/Madrid',
  reminderId: 'abc-123',
};

describe('buildReminderVars', () => {
  it('arma vars completas con fecha/hora en TZ local', () => {
    const v = buildReminderVars(baseInput);
    expect(v.contact.firstName).toBe('María');
    expect(v.contact.fullName).toBe('María Pérez');
    expect(v.appointment.time).toBe('10:30');
    expect(v.appointment.treatment).toBe('Limpieza dental');
    expect(v.appointment.durationMinutes).toBe('45');
    expect(v.appointment.date.toLowerCase()).toContain('mayo');
    expect(v.clinic.name).toBe('Clínica Sonrisa');
    expect(v.reminderId).toBe('abc-123');
  });

  it('contact sin nombre → fullName fallback "paciente"', () => {
    const v = buildReminderVars({
      ...baseInput,
      contactFirstName: null,
      contactLastName: null,
    });
    expect(v.contact.fullName).toBe('paciente');
  });

  it('treatment null → "tu cita" fallback', () => {
    const v = buildReminderVars({ ...baseInput, treatmentName: null });
    expect(v.appointment.treatment).toBe('tu cita');
  });
});

describe('resolveVar', () => {
  const v = buildReminderVars(baseInput);

  it('camelCase path', () => {
    expect(resolveVar('contact.firstName', v)).toBe('María');
    expect(resolveVar('clinic.name', v)).toBe('Clínica Sonrisa');
  });

  it('snake_case path se normaliza a camelCase', () => {
    expect(resolveVar('contact.first_name', v)).toBe('María');
    expect(resolveVar('clinic.timezone', v)).toBe('Europe/Madrid');
  });

  it('path inexistente → string vacío', () => {
    expect(resolveVar('does.not.exist', v)).toBe('');
    expect(resolveVar('contact.middleName', v)).toBe('');
  });
});

describe('interpolate', () => {
  const v = buildReminderVars(baseInput);

  it('interpola con varias variables', () => {
    const t = interpolate(
      'Hola {{contact.first_name}}, te recordamos tu cita de {{appointment.treatment}} a las {{appointment.time}}.',
      v,
    );
    expect(t).toBe('Hola María, te recordamos tu cita de Limpieza dental a las 10:30.');
  });

  it('var no encontrada → vacío (no deja {{x}})', () => {
    const t = interpolate('Hola {{contact.first_name}} {{contact.unknown}}', v);
    expect(t).toBe('Hola María ');
  });

  it('respeta espacios dentro de {{ }}', () => {
    const t = interpolate('{{   clinic.name   }}', v);
    expect(t).toBe('Clínica Sonrisa');
  });
});
