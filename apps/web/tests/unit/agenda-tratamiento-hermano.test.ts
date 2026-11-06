import { describe, expect, it } from 'vitest';

import { pickTreatmentForChild } from '@/lib/agenda/treatment-pick';

const catalog = [
  { name: 'GEMELOS / MELLIZOS', visitKind: 'FOLLOW_UP' },
  { name: 'HERMANO PEQUEÑO - PRIMERA VISITA', visitKind: 'FIRST' },
  { name: 'PRIMERA VISITA', visitKind: 'FIRST' },
  { name: 'VISITA RECURRENTE', visitKind: 'FOLLOW_UP' },
];
const twin = (n: string) => /gemel|melliz/i.test(n);

describe('qué tratamiento le toca a un niño', () => {
  it('niño nuevo de una familia nueva: la primera visita normal', () => {
    expect(
      pickTreatmentForChild({
        hasHistory: false,
        familyKnown: false,
        requested: null,
        catalog,
        isTwinTreatment: twin,
      }),
    ).toBe('PRIMERA VISITA');
  });

  it('niño nuevo cuyo hermano ya vino: la primera visita de hermano', () => {
    expect(
      pickTreatmentForChild({
        hasHistory: false,
        familyKnown: true,
        requested: null,
        catalog,
        isTwinTreatment: twin,
      }),
    ).toBe('HERMANO PEQUEÑO - PRIMERA VISITA');
    // Aunque el modelo pida la normal: la familia ya nos conoce.
    expect(
      pickTreatmentForChild({
        hasHistory: false,
        familyKnown: true,
        requested: 'PRIMERA VISITA',
        catalog,
        isTwinTreatment: twin,
      }),
    ).toBe('HERMANO PEQUEÑO - PRIMERA VISITA');
  });

  it('con historia, el seguimiento (nunca el de mellizos)', () => {
    expect(
      pickTreatmentForChild({
        hasHistory: true,
        familyKnown: true,
        requested: 'PRIMERA VISITA',
        catalog,
        isTwinTreatment: twin,
      }),
    ).toBe('VISITA RECURRENTE');
  });

  it('sin tratamiento de hermano en el catálogo, cae a la primera visita normal', () => {
    const sinHermano = catalog.filter((t) => !/herman/i.test(t.name));
    expect(
      pickTreatmentForChild({
        hasHistory: false,
        familyKnown: true,
        requested: null,
        catalog: sinHermano,
        isTwinTreatment: twin,
      }),
    ).toBe('PRIMERA VISITA');
  });

  it('el de hermano sin visit_kind (como estaba cargado) no se elige: por eso existe la migración 0065', () => {
    const sinMarcar = catalog.map((t) => (/herman/i.test(t.name) ? { ...t, visitKind: null } : t));
    expect(
      pickTreatmentForChild({
        hasHistory: false,
        familyKnown: true,
        requested: null,
        catalog: sinMarcar,
        isTwinTreatment: twin,
      }),
    ).toBe('PRIMERA VISITA');
  });
});
