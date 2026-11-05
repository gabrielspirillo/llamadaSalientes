import { describe, expect, it } from 'vitest';

import { sectionForPath, sectionLabel } from '@/lib/usage/sections';

describe('sección de cada pantalla', () => {
  it('reconoce las pantallas del panel', () => {
    expect(sectionForPath('/dashboard')).toBe('home');
    expect(sectionForPath('/dashboard/')).toBe('home');
    expect(sectionForPath('/dashboard/agenda')).toBe('agenda');
    expect(sectionForPath('/dashboard/agenda?cita=1')).toBe('agenda');
    expect(sectionForPath('/dashboard/agenda/pacientes/pat%3Aabc')).toBe('patients');
    expect(sectionForPath('/dashboard/whatsapp/123')).toBe('whatsapp');
    expect(sectionForPath('/dashboard/finanzas?tab=resumen')).toBe('finance');
  });

  it('no cuenta Futura, ni lo que no es del panel', () => {
    expect(sectionForPath('/dashboard/futura')).toBeNull();
    expect(sectionForPath('/dashboard/futura/uso')).toBeNull();
    expect(sectionForPath('/sign-in')).toBeNull();
  });

  it('lo desconocido va a "otras" y tiene nombre', () => {
    expect(sectionForPath('/dashboard/algo-nuevo')).toBe('other');
    expect(sectionLabel('patients')).toBe('Fichas de pacientes');
  });

  it('no confunde prefijos parecidos', () => {
    expect(sectionForPath('/dashboard/agent')).toBe('agent_test');
    expect(sectionForPath('/dashboard/agenda')).toBe('agenda');
  });
});
