import { describe, expect, it } from 'vitest';

import {
  type FamilyPatient,
  familyTagFor,
  familyTagFromTreatment,
  groupFamilies,
  surnamesKey,
} from '@/lib/care-profile/siblings';

function p(over: Partial<FamilyPatient> & { id: string }): FamilyPatient {
  return {
    contactId: null,
    phones: [],
    birthDate: null,
    siblingMark: null,
    firstVisitDate: null,
    ...over,
  };
}

describe('hermanos y gemelos', () => {
  const lucas = p({ id: 'lucas', contactId: 'c1', birthDate: '2024-03-01' });
  const marta = p({ id: 'marta', contactId: 'c1', birthDate: '2024-03-01' });
  const hugo = p({
    id: 'hugo',
    phones: ['+34 646 55 66 19'],
    birthDate: '2022-01-10',
    firstVisitDate: '2025-03-04',
  });
  const ines = p({ id: 'ines', phones: ['646556619'], birthDate: '2024-09-09' });
  const solo = p({ id: 'solo', contactId: 'c9' });
  const families = groupFamilies([lucas, marta, hugo, ines, solo]);
  const byId = new Map([lucas, marta, hugo, ines, solo].map((x) => [x.id, x]));
  const sibs = (id: string) => (families.get(id) ?? []).map((s) => byId.get(s) as FamilyPatient);

  it('agrupa por contacto y por teléfono de tutor (con o sin prefijo)', () => {
    expect(families.get('lucas')).toEqual(['marta']);
    expect(families.get('hugo')).toEqual(['ines']);
    expect(families.get('solo')).toEqual([]);
  });

  it('gemelos: misma fecha de nacimiento, siempre', () => {
    expect(familyTagFor(lucas, '2026-10-20', sibs('lucas'))).toBe('GM');
  });

  it('hermano: el otro ya vino antes a la clínica', () => {
    // Inés es la pequeña: su hermano Hugo vino en 2025, así que la familia ya nos conoce.
    expect(familyTagFor(ines, '2026-10-20', sibs('ines'))).toBe('H');
    // Hugo no: Inés nunca vino.
    expect(familyTagFor(hugo, '2026-10-20', sibs('hugo'))).toBeNull();
    // Antes de la primera visita de Hugo, la familia aún no había venido.
    expect(familyTagFor(ines, '2025-03-04', sibs('ines'))).toBeNull();
  });

  it('la marca manual manda', () => {
    expect(familyTagFor({ ...solo, siblingMark: 'SIBLING' }, 'x', [])).toBe('H');
    expect(familyTagFor({ ...solo, siblingMark: 'TWIN' }, 'x', [])).toBe('GM');
    expect(familyTagFor({ ...lucas, siblingMark: 'NONE' }, 'x', sibs('lucas'))).toBeNull();
  });

  it('mellizos con el móvil de cada progenitor: los une el doble apellido', () => {
    const dylan = p({
      id: 'dylan',
      phones: ['+34600000001'],
      lastName: 'García Pérez',
      birthDate: '2025-02-01',
    });
    const uriel = p({
      id: 'uriel',
      phones: ['+34600000002'],
      lastName: 'Garcia Perez',
      birthDate: '2025-02-01',
    });
    const otro = p({ id: 'otro', phones: ['+34600000003'], lastName: 'García' });
    const fam = groupFamilies([dylan, uriel, otro]);
    expect(fam.get('dylan')).toEqual(['uriel']);
    // Con un solo apellido no se une a nadie: "García" a secas no es familia.
    expect(fam.get('otro')).toEqual([]);
    expect(familyTagFor(dylan, '2026-10-26', [uriel])).toBe('GM');
    expect(surnamesKey('Ruiz')).toBeNull();
  });

  it('el tratamiento dicta la etiqueta', () => {
    expect(familyTagFromTreatment('GEMELOS / MELLIZOS')).toBe('GM');
    expect(familyTagFromTreatment('Primera visita hermanos')).toBe('H');
    expect(familyTagFromTreatment('PRIMERA VISITA')).toBeNull();
    expect(familyTagFromTreatment(null)).toBeNull();
  });
});
