import { describe, expect, it } from 'vitest';

import {
  type CareProfile,
  buildCareProtocolSection,
  parseAnamnesisTemplate,
  parseBookingPolicy,
} from '@/lib/care-profile/policy';

/**
 * La sección del prompt que hace que un asistente atienda como una clínica
 * pediátrica. Es la misma para WhatsApp y para voz.
 */

function profile(overrides: Partial<CareProfile> = {}): CareProfile {
  return {
    tenantId: 't1',
    profile: 'PEDIATRIC',
    bookingPolicy: parseBookingPolicy({
      patientAgeMonths: { min: 0, max: 59 },
      fastingHours: 2,
      priorityAgeMonths: { veryHighMax: 6, highMax: 24 },
      siblingsConsecutive: true,
    }),
    anamnesisTemplate: parseAnamnesisTemplate([]),
    firstVisitProtocol: 'Pregunta la edad del niño.\nInforma del ayuno de 2 horas.',
    ...overrides,
  };
}

describe('buildCareProtocolSection', () => {
  it('dice quién es el paciente, la edad admitida y cómo usar las tools con patient_id', () => {
    const text = buildCareProtocolSection(profile());
    expect(text).toContain('El PACIENTE es el niño o la niña');
    expect(text).toContain('de 0 a 4 años (incluidos)');
    expect(text).toContain('birth_date (YYYY-MM-DD) es obligatoria');
    expect(text).toContain('medical_alert');
    expect(text).toContain('first_visit=true');
    expect(text).toContain('pasa SIEMPRE patient_id');
  });

  it('gemelos y prioridad sólo si la política los pide', () => {
    const con = buildCareProtocolSection(profile());
    expect(con).toContain('Gemelos o hermanos');
    expect(con).toContain('hasta 6 meses son MUY prioritarios');
    expect(con).toContain('hasta 24 meses prioritarios');

    const sin = buildCareProtocolSection(
      profile({ bookingPolicy: parseBookingPolicy({ patientAgeMonths: { min: 0, max: 59 } }) }),
    );
    expect(sin).not.toContain('Gemelos');
    expect(sin).not.toContain('prioritarios');
  });

  it('el protocolo de la clínica va al final, con sus palabras', () => {
    const text = buildCareProtocolSection(profile());
    expect(text).toContain('# Protocolo de primera visita (palabras de la clínica)');
    expect(text.endsWith('Informa del ayuno de 2 horas.')).toBe(true);

    const sinProtocolo = buildCareProtocolSection(profile({ firstVisitProtocol: null }));
    expect(sinProtocolo).not.toContain('palabras de la clínica');
  });

  it('sin tope de edad no promete un rango', () => {
    const text = buildCareProtocolSection(profile({ bookingPolicy: parseBookingPolicy({}) }));
    expect(text).not.toContain('Sólo se atiende');
  });
});
