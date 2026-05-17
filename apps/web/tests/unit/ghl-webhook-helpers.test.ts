import { describe, expect, it } from 'vitest';
import { classifyEvent, parseDate } from '@/lib/analytics/ghl-webhook-helpers';

describe('parseDate', () => {
  it('devuelve Date para ISO válido', () => {
    const d = parseDate('2025-05-17T10:00:00.000Z');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCFullYear()).toBe(2025);
  });

  it('devuelve null para undefined o string vacío', () => {
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('devuelve null para string inválido', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('classifyEvent', () => {
  it('clasifica AppointmentCreate como create', () => {
    expect(classifyEvent({ type: 'AppointmentCreate' })).toBe('create');
    expect(classifyEvent({ type: 'appointment.create' })).toBe('create');
  });

  it('clasifica AppointmentDelete como cancel', () => {
    expect(classifyEvent({ type: 'AppointmentDelete' })).toBe('cancel');
    expect(classifyEvent({ type: 'appointment.delete' })).toBe('cancel');
  });

  it('clasifica update con status cancelled como cancel', () => {
    expect(
      classifyEvent({
        type: 'AppointmentUpdate',
        appointment: { status: 'cancelled' },
      }),
    ).toBe('cancel');
    expect(
      classifyEvent({
        type: 'AppointmentUpdate',
        appointment: { status: 'canceled' },
      }),
    ).toBe('cancel');
  });

  it('clasifica status no_show como cancel', () => {
    expect(
      classifyEvent({
        type: 'AppointmentUpdate',
        appointment: { status: 'no_show' },
      }),
    ).toBe('cancel');
  });

  it('devuelve null para eventos no relevantes', () => {
    expect(classifyEvent({ type: 'ContactCreate' })).toBeNull();
    expect(classifyEvent({})).toBeNull();
    expect(
      classifyEvent({
        type: 'AppointmentUpdate',
        appointment: { status: 'confirmed' },
      }),
    ).toBeNull();
  });

  it('prioriza delete type sobre status', () => {
    expect(
      classifyEvent({
        type: 'AppointmentDelete',
        appointment: { status: 'confirmed' },
      }),
    ).toBe('cancel');
  });
});
