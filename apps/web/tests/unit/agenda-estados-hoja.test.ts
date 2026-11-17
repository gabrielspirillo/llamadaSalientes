import { type AppointmentStatus, statusChoices } from '@/lib/agenda/shared';
import { describe, expect, it } from 'vitest';

const FLOW: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];
const RESPINENS = ['SCHEDULED', 'CONFIRMED', 'NO_SHOW', 'COMPLETED'];

describe('statusChoices', () => {
  it('antes de la sesión ofrece Agendada con los estados de la clínica', () => {
    expect(
      statusChoices(FLOW, { visibleStatuses: RESPINENS, status: 'CONFIRMED', started: false }),
    ).toEqual(['SCHEDULED', 'CONFIRMED', 'COMPLETED']);
  });

  it('empezada la sesión, una cita confirmada ya no puede volver a Agendada', () => {
    expect(
      statusChoices(FLOW, { visibleStatuses: RESPINENS, status: 'CONFIRMED', started: true }),
    ).toEqual(['CONFIRMED', 'COMPLETED']);
  });

  it('si sigue Agendada, se ve su estado aunque haya empezado', () => {
    expect(
      statusChoices(FLOW, { visibleStatuses: RESPINENS, status: 'SCHEDULED', started: true }),
    ).toEqual(['SCHEDULED', 'CONFIRMED', 'COMPLETED']);
  });

  it('sin estados propios ofrece el flujo completo', () => {
    expect(
      statusChoices(FLOW, { visibleStatuses: null, status: 'ARRIVED', started: true }),
    ).toEqual(['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']);
  });
});
