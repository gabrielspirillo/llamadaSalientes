import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  calendarRefForProfessional,
  isCrmAppointmentId,
  isInternalAppointmentId,
  professionalFromCalendarRef,
} from '@/lib/agenda/appointment-ref';
import { contactRefsFor, patientKeyFor, phoneFromPatientKey } from '@/lib/agenda/patients';

/**
 * La identidad compartida entre la agenda de la plataforma y las tablas que
 * nacieron para GoHighLevel.
 *
 * Las citas viven en dos sitios y las tablas de recordatorios, huecos
 * cancelados y lista de espera tienen UNA sola columna de texto para el id.
 * Que los dos formatos no se pisen es lo que sostiene todo el mecanismo, así
 * que se fija aquí.
 */

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const CRM_ID = 'W5CUSlYRHfeubqP8j29P';

describe('de qué origen es una cita', () => {
  it('un UUID es de la agenda de la plataforma', () => {
    expect(isInternalAppointmentId(UUID)).toBe(true);
    expect(isInternalAppointmentId(UUID.toUpperCase())).toBe(true);
    expect(isCrmAppointmentId(UUID)).toBe(false);
  });

  it('un id de GoHighLevel es alfanumérico y sin guiones', () => {
    expect(isCrmAppointmentId(CRM_ID)).toBe(true);
    expect(isInternalAppointmentId(CRM_ID)).toBe(false);
  });

  it('los dos formatos no se solapan nunca', () => {
    // Es la garantía de la que depende que una sola columna sirva para ambos.
    expect(isInternalAppointmentId(CRM_ID) && isCrmAppointmentId(CRM_ID)).toBe(false);
    expect(isInternalAppointmentId(UUID) && isCrmAppointmentId(UUID)).toBe(false);
  });

  it('nada de basura pasa por ninguno de los dos', () => {
    for (const raw of ['', '   ', 'abc', 'tel:+34600111222', null, undefined]) {
      expect(isInternalAppointmentId(raw)).toBe(false);
      expect(isCrmAppointmentId(raw)).toBe(false);
    }
  });
});

describe('la agenda de un profesional hace de calendario', () => {
  it('ida y vuelta', () => {
    const ref = calendarRefForProfessional(UUID);
    expect(ref).toBe(`prof:${UUID}`);
    expect(professionalFromCalendarRef(ref)).toBe(UUID);
  });

  it('un calendario de GoHighLevel no se confunde con un profesional', () => {
    expect(professionalFromCalendarRef('cal-abc123')).toBeNull();
    expect(professionalFromCalendarRef(null)).toBeNull();
  });
});

describe('identidades con las que se busca a un paciente', () => {
  it('con CRM se busca por su id, crudo y prefijado', () => {
    const refs = contactRefsFor({ ghlContactId: CRM_ID, phone: '+34600111222' });
    expect(refs).toContain(CRM_ID);
    expect(refs).toContain(`ghl:${CRM_ID}`);
    // El teléfono también: la misma persona puede tener citas de los dos orígenes.
    expect(refs).toContain('tel:+34600111222');
  });

  it('sin CRM, el teléfono normalizado es la identidad', () => {
    expect(contactRefsFor({ phone: '+34 600 111 222' })).toEqual(['tel:+34600111222']);
    expect(contactRefsFor({ phone: '0034600111222' })).toEqual(['tel:+34600111222']);
  });

  it('sin ningún dato utilizable no se busca nada', () => {
    // Importa: una lista vacía evita una consulta que traería citas ajenas.
    expect(contactRefsFor({})).toEqual([]);
    expect(contactRefsFor({ ghlContactId: '  ', phone: 'no-es-un-telefono' })).toEqual([]);
    expect(contactRefsFor({ phone: '123' })).toEqual([]);
  });

  it('la identidad de la agenda y la que se busca coinciden', () => {
    // Sin esto, una cita guardada bajo `tel:` no se encontraría al abrir la ficha.
    const key = patientKeyFor({ phone: '+34600111222', name: 'Marta' });
    expect(key).toBe('tel:+34600111222');
    expect(contactRefsFor({ phone: '+34600111222' })).toContain(key);
    expect(phoneFromPatientKey(key)).toBe('+34600111222');
  });

  it('el id del CRM manda sobre el teléfono al fijar la identidad', () => {
    expect(patientKeyFor({ ghlContactId: CRM_ID, phone: '+34600111222' })).toBe(`ghl:${CRM_ID}`);
  });
});
