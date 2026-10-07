import { describe, expect, it } from 'vitest';

import { pickAppointmentsToCancel } from '@/lib/agenda/cancel-match';
import { reconciliar } from '@/scripts/retell/sync-agenda-tools';

const TZ = 'Europe/Madrid';

// Dos hermanos con el mismo teléfono de tutor, y Lucas con dos citas.
const citas = [
  { id: 'a', patientName: 'Lucas Velasques', startsAt: new Date('2026-10-13T14:00:00Z') },
  { id: 'b', patientName: 'Martina Velasques', startsAt: new Date('2026-10-13T14:30:00Z') },
  { id: 'c', patientName: 'Lucas Velasques', startsAt: new Date('2026-10-20T14:00:00Z') },
];

describe('pickAppointmentsToCancel', () => {
  it('elige por nombre, sin tildes ni mayúsculas', () => {
    const out = pickAppointmentsToCancel(citas, { patientName: 'MARTINA', timezone: TZ });
    expect(out.map((c) => c.id)).toEqual(['b']);
  });

  it('con varias del mismo paciente, el día decide', () => {
    expect(pickAppointmentsToCancel(citas, { patientName: 'lucas', timezone: TZ })).toHaveLength(2);
    const out = pickAppointmentsToCancel(citas, {
      patientName: 'Lucas',
      dateKey: '2026-10-20',
      timezone: TZ,
    });
    expect(out.map((c) => c.id)).toEqual(['c']);
  });

  it('un nombre que no casa no deja la lista vacía: se pregunta cuál', () => {
    // El tutor suele decir su propio nombre; la cita está a nombre del niño.
    const out = pickAppointmentsToCancel(citas, { patientName: 'Vanesa', timezone: TZ });
    expect(out).toHaveLength(3);
  });

  it('el día se compara en hora local de la clínica', () => {
    const tarde = [
      { id: 'x', patientName: 'Ana', startsAt: new Date('2026-10-13T22:30:00Z') }, // 00:30 del 14 en Madrid
    ];
    expect(pickAppointmentsToCancel(tarde, { dateKey: '2026-10-14', timezone: TZ })).toHaveLength(
      1,
    );
  });
});

describe('reconciliar cancel_appointment', () => {
  it('quita appointment_id de los obligatorios y añade patient_name y date', () => {
    const { tools, faltaba } = reconciliar([
      {
        name: 'cancel_appointment',
        type: 'custom',
        parameters: {
          type: 'object',
          properties: { appointment_id: { type: 'string' } },
          required: ['appointment_id'],
        },
      },
    ]);
    const cancel = tools.find((t) => t.name === 'cancel_appointment');
    expect(cancel?.parameters?.required).toEqual([]);
    expect(cancel?.parameters?.properties).toHaveProperty('patient_name');
    expect(cancel?.parameters?.properties).toHaveProperty('date');
    expect(faltaba).toContain('cancel_appointment.appointment_id opcional');
    // Idempotente.
    expect(reconciliar(tools).faltaba).toEqual([]);
  });
});
