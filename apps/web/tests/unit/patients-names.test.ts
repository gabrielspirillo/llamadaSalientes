import { describe, expect, it } from 'vitest';

import { formatPhoneDisplay, initialsOf, phoneDigits, titleCaseName } from '@/lib/patients/names';

describe('titleCaseName', () => {
  it('normaliza mayúsculas pegadas y versales', () => {
    expect(titleCaseName('ADrian ortiz')).toBe('Adrian Ortiz');
    expect(titleCaseName('MARTINA LÓPEZ GARCÍA')).toBe('Martina López García');
  });

  it('respeta partículas, guiones y apóstrofos', () => {
    expect(titleCaseName('juan de la cruz')).toBe('Juan de la Cruz');
    expect(titleCaseName('jean-luc o\'neil')).toBe("Jean-Luc O'Neil");
    expect(titleCaseName('  de   los santos ')).toBe('De los Santos');
  });

  it('vacío o nulo devuelve cadena vacía', () => {
    expect(titleCaseName('')).toBe('');
    expect(titleCaseName(null)).toBe('');
  });
});

describe('formatPhoneDisplay', () => {
  it('agrupa por país: Uruguay, España, México', () => {
    expect(formatPhoneDisplay('+59892206700')).toBe('+598 92 206 700');
    expect(formatPhoneDisplay('+34600112233')).toBe('+34 600 11 22 33');
    expect(formatPhoneDisplay('+525512345678')).toBe('+52 551 234 5678');
    expect(formatPhoneDisplay('+14155552671')).toBe('+1 415 555 2671');
  });

  it('lo que no es internacional se devuelve tal cual', () => {
    expect(formatPhoneDisplay('600 11 22 33')).toBe('600 11 22 33');
    expect(formatPhoneDisplay('')).toBe('');
    expect(phoneDigits('+598 92 206 700')).toBe('59892206700');
  });
});

describe('initialsOf', () => {
  it('dos iniciales como mucho', () => {
    expect(initialsOf('Martina López García')).toBe('ML');
    expect(initialsOf('Adrian')).toBe('A');
  });
});
