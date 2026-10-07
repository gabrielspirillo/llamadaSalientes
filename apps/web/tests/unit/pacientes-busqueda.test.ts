import { describe, expect, it } from 'vitest';

import {
  FOLD_FROM,
  FOLD_TO,
  escapeLike,
  foldSearchText,
  phoneDigitsQuery,
} from '@/lib/patients/search-text';

describe('foldSearchText', () => {
  it('ignora tildes y mayúsculas', () => {
    expect(foldSearchText('Santallá')).toBe('santalla');
    expect(foldSearchText('SANTALLA')).toBe('santalla');
    expect(foldSearchText('  Martín Caballero ')).toBe('martin caballero');
    expect(foldSearchText('Muñoz Güell')).toBe('munoz guell');
  });

  it('las dos listas de translate tienen la misma longitud', () => {
    // Si no, Postgres borra las letras sobrantes en vez de cambiarlas.
    expect([...FOLD_FROM].length).toBe([...FOLD_TO].length);
  });
});

describe('escapeLike', () => {
  it('escapa los comodines', () => {
    expect(escapeLike('50%_a\\')).toBe('50\\%\\_a\\\\');
  });
});

describe('phoneDigitsQuery', () => {
  it('reconoce teléfonos', () => {
    expect(phoneDigitsQuery('+34 600 29 68 83')).toBe('34600296883');
    expect(phoneDigitsQuery('600-29')).toBe('60029');
  });

  it('no confunde nombres ni números cortos con teléfonos', () => {
    expect(phoneDigitsQuery('Julieta 2')).toBeNull();
    expect(phoneDigitsQuery('60')).toBeNull();
  });
});
