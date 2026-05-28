import { describe, expect, it } from 'vitest';

import {
  applyQuietHours,
  type WorkingHours,
} from '@/lib/reminders/quiet-hours';

const MADRID: WorkingHours = {
  monday: { open: '09:00', close: '18:00' },
  tuesday: { open: '09:00', close: '18:00' },
  wednesday: { open: '09:00', close: '18:00' },
  thursday: { open: '09:00', close: '18:00' },
  friday: { open: '09:00', close: '18:00' },
  saturday: null,
  sunday: null,
};

// Helpers para construir Date en Europe/Madrid wall-clock.
// 2026-05-25 (lunes), no en DST en mayo == UTC+2.
// Para simplificar usamos UTC explícito y nos basamos en que mayo es +2.
function utc(iso: string): Date {
  return new Date(iso);
}

describe('applyQuietHours', () => {
  const tz = 'Europe/Madrid';

  it('dentro del horario laboral → devuelve scheduledFor sin cambio', () => {
    // Lunes 25 mayo 2026, 10:30 local Madrid → 08:30 UTC.
    const scheduledFor = utc('2026-05-25T08:30:00Z');
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.scheduledFor.toISOString()).toBe(scheduledFor.toISOString());
  });

  it('antes de la apertura del mismo día (lunes 03:00 local) → mueve a 09:00 local', () => {
    // Lunes 25 mayo 2026, 03:00 local Madrid → 01:00 UTC.
    const scheduledFor = utc('2026-05-25T01:00:00Z');
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      // 09:00 Madrid = 07:00 UTC en mayo (UTC+2).
      expect(r.scheduledFor.toISOString()).toBe('2026-05-25T07:00:00.000Z');
    }
  });

  it('después del cierre lunes → próximo día con horario (martes 09:00)', () => {
    // Lunes 25 mayo 2026, 22:00 local Madrid → 20:00 UTC.
    const scheduledFor = utc('2026-05-25T20:00:00Z');
    const appointmentStart = utc('2026-05-26T15:00:00Z'); // martes 17:00 Madrid
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      // Martes 26 mayo 09:00 Madrid = 07:00 UTC.
      expect(r.scheduledFor.toISOString()).toBe('2026-05-26T07:00:00.000Z');
    }
  });

  it('domingo cerrado + lunes feriado → busca próximo día con horario', () => {
    // Sábado y domingo cerrado. Domingo 24 mayo 2026 12:00 local Madrid.
    const scheduledFor = utc('2026-05-24T10:00:00Z'); // dom 12:00 local
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      // Lunes 25 mayo 09:00 Madrid = 07:00 UTC.
      expect(r.scheduledFor.toISOString()).toBe('2026-05-25T07:00:00.000Z');
    }
  });

  it('modo SKIP + scheduledFor fuera de horario → skip', () => {
    const scheduledFor = utc('2026-05-25T01:00:00Z');
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SKIP',
    });
    expect(r.kind).toBe('skip');
  });

  it('shift llevaría el reminder después del appointmentStart → skip', () => {
    // Lunes 22:00 local, cita martes 08:30 local (antes del open martes 09:00).
    const scheduledFor = utc('2026-05-25T20:00:00Z'); // lun 22:00 local
    const appointmentStart = utc('2026-05-26T06:30:00Z'); // mar 08:30 local (antes del open)
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: MADRID,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('skip');
  });

  it('workingHours null/vacío → no aplica restricción', () => {
    const scheduledFor = utc('2026-05-25T01:00:00Z');
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: null,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.scheduledFor.toISOString()).toBe(scheduledFor.toISOString());
  });

  it('todos los días null → skip', () => {
    const closed: WorkingHours = {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
    const scheduledFor = utc('2026-05-25T08:30:00Z');
    const appointmentStart = utc('2026-05-26T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: tz,
      workingHours: closed,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('skip');
  });

  it('TZ America/Mexico_City (UTC-6) respeta wall-clock local', () => {
    // 2026-01-15 jueves, 04:00 local CDMX = 10:00 UTC.
    // Como el horario abre a 09:00 CDMX → debe shiftear a las 09:00 local = 15:00 UTC.
    const mxHours: WorkingHours = {
      monday: { open: '09:00', close: '18:00' },
      tuesday: { open: '09:00', close: '18:00' },
      wednesday: { open: '09:00', close: '18:00' },
      thursday: { open: '09:00', close: '18:00' },
      friday: { open: '09:00', close: '18:00' },
      saturday: null,
      sunday: null,
    };
    const scheduledFor = utc('2026-01-15T10:00:00Z');
    const appointmentStart = utc('2026-01-16T10:00:00Z');
    const r = applyQuietHours({
      scheduledFor,
      appointmentStart,
      timeZone: 'America/Mexico_City',
      workingHours: mxHours,
      mode: 'SHIFT_INTO_HOURS',
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.scheduledFor.toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });
});
