import { describe, expect, it } from 'vitest';

import {
  bookingMessages,
  buildScriptsSection,
  parseMessageScripts,
  scriptDateParts,
} from '@/lib/care-profile/messages';

const s = {
  firstVisitBooked: ['Cita para {{paciente}}:\n{{fecha}}\n{{hora}}', 'Ayuno', 'Dirección'],
  returningBooked: ['Cita para {{paciente}}: {{fecha}} {{hora}}', 'Recuerda'],
  thanks: 'Muchas gracias a ti',
};
const startsAt = new Date('2026-11-02T11:30:00Z'); // 12:30 en Madrid (invierno)

describe('guiones de la clínica', () => {
  it('fecha como la escribe la clínica', () => {
    expect(scriptDateParts(startsAt, 'Europe/Madrid')).toEqual({
      fecha: 'Lunes, 2 de noviembre',
      hora: '12:30',
    });
  });

  it('primera visita de cero → guion A con sus tres mensajes', () => {
    const out = bookingMessages(s, {
      patientFirstName: 'Zoe',
      startsAt,
      timezone: 'Europe/Madrid',
      isFirstVisit: true,
      siblingCameBefore: false,
    });
    expect(out).toEqual(['Cita para Zoe:\nLunes, 2 de noviembre\n12:30', 'Ayuno', 'Dirección']);
  });

  it('primera visita de un hermano de alguien que ya vino → guion B', () => {
    const out = bookingMessages(s, {
      patientFirstName: 'Leo',
      startsAt,
      timezone: 'Europe/Madrid',
      isFirstVisit: true,
      siblingCameBefore: true,
    });
    expect(out[0]).toBe('Cita para Leo: Lunes, 2 de noviembre 12:30');
    expect(out).toHaveLength(2);
  });

  it('paciente que vuelve → guion B', () => {
    const out = bookingMessages(s, {
      patientFirstName: null,
      startsAt,
      timezone: 'Europe/Madrid',
      isFirstVisit: false,
      siblingCameBefore: false,
    });
    expect(out[0]).toContain('tu peque');
  });

  it('sin guiones no hay sección ni perfil de mensajes', () => {
    expect(parseMessageScripts({})).toBeNull();
    expect(parseMessageScripts(s)).not.toBeNull();
    expect(buildScriptsSection(s)).toContain('Muchas gracias a ti');
  });
});
