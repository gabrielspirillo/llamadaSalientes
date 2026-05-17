import { describe, expect, it } from 'vitest';
import {
  classifyEvent,
  normalizeAppointment,
  parseDate,
} from '@/lib/analytics/ghl-webhook-helpers';

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

  it('clasifica create desde shape de Workflow Builder (calendar.appoinmentStatus confirmed)', () => {
    expect(
      classifyEvent({
        calendar: {
          appointmentId: 'apt-1',
          appoinmentStatus: 'confirmed',
        },
        location: { id: 'loc-1' },
      }),
    ).toBe('create');
  });

  it('clasifica cancel desde shape de Workflow Builder (calendar.appoinmentStatus cancelled)', () => {
    expect(
      classifyEvent({
        calendar: {
          appointmentId: 'apt-1',
          appoinmentStatus: 'cancelled',
        },
      }),
    ).toBe('cancel');
  });

  it('respeta customData.type cuando viene de Workflow Builder', () => {
    expect(
      classifyEvent({
        calendar: { appointmentId: 'apt-1', appoinmentStatus: 'cancelled' },
        customData: { type: 'AppointmentDelete' },
      }),
    ).toBe('cancel');
  });
});

describe('normalizeAppointment', () => {
  it('lee shape nativo {appointment, locationId, type}', () => {
    const result = normalizeAppointment({
      type: 'AppointmentCreate',
      locationId: 'loc-1',
      appointment: {
        id: 'apt-1',
        calendarId: 'cal-1',
        contactId: 'ct-1',
        startTime: '2026-05-18T10:00:00Z',
        status: 'confirmed',
      },
    });
    expect(result.appointment.id).toBe('apt-1');
    expect(result.appointment.calendarId).toBe('cal-1');
    expect(result.appointment.status).toBe('confirmed');
    expect(result.locationId).toBe('loc-1');
    expect(result.type).toBe('AppointmentCreate');
  });

  it('lee shape de Workflow Builder (calendar.* + location.id + contact_id)', () => {
    const result = normalizeAppointment({
      calendar: {
        id: 'cal-1',
        appointmentId: 'apt-1',
        appoinmentStatus: 'confirmed',
        startTime: '2026-05-18T10:00:00',
        endTime: '2026-05-18T10:30:00',
        date_created: '2026-05-17T16:29:37Z',
      },
      location: { id: 'loc-1' },
      contact_id: 'ct-1',
    });
    expect(result.appointment.id).toBe('apt-1');
    expect(result.appointment.calendarId).toBe('cal-1');
    expect(result.appointment.contactId).toBe('ct-1');
    expect(result.appointment.startTime).toBe('2026-05-18T10:00:00');
    expect(result.appointment.endTime).toBe('2026-05-18T10:30:00');
    expect(result.appointment.status).toBe('confirmed');
    expect(result.appointment.dateAdded).toBe('2026-05-17T16:29:37Z');
    expect(result.locationId).toBe('loc-1');
  });

  it('cae a customData.type cuando type root no existe', () => {
    const result = normalizeAppointment({
      calendar: { appointmentId: 'apt-1' },
      customData: { type: 'AppointmentDelete' },
    });
    expect(result.type).toBe('AppointmentDelete');
  });
});
