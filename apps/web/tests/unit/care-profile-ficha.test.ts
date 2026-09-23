import { describe, expect, it } from 'vitest';

import {
  describeWatchouts,
  guardianNames,
  parseAnamnesisTemplate,
} from '@/lib/care-profile/policy';

/**
 * La cabecera de la ficha rediseñada: quiénes son los tutores y qué hay que
 * tener en cuenta antes de atender.
 */

const template = parseAnamnesisTemplate([
  { key: 'sano', label: 'Sano' },
  { key: 'prematuro', label: 'Prematuro', alert: true },
  { key: 'ingresos', label: 'Ingresos', alert: true },
  { key: 'alergias', label: 'Alergias', alert: true },
  { key: 'hermanos', label: 'Hermanos' },
]);

describe('describeWatchouts', () => {
  it('sólo los "sí" de los ítems marcados como alerta, con su detalle', () => {
    const out = describeWatchouts(template, {
      prematuro: { value: true, detail: '34 semanas' },
      ingresos: { value: true, detail: '' },
      alergias: { value: false, detail: '' },
      hermanos: { value: true, detail: '1 hermano' },
    });
    expect(out).toEqual(['Prematuro: 34 semanas', 'Ingresos']);
  });

  it('el motivo de la prioridad manual va primero', () => {
    const out = describeWatchouts(
      template,
      { prematuro: { value: true, detail: '' } },
      { priorityFlag: true, priorityReason: 'Bronquiolitis de repetición' },
    );
    expect(out).toEqual(['Bronquiolitis de repetición', 'Prematuro']);
  });

  it('sin marca, el motivo no cuenta; sin nada, la lista queda vacía', () => {
    expect(
      describeWatchouts(template, {}, { priorityFlag: false, priorityReason: 'Viejo motivo' }),
    ).toEqual([]);
  });

  it('la plantilla acepta `alert` y lo conserva', () => {
    expect(template.find((i) => i.key === 'prematuro')?.alert).toBe(true);
    expect(template.find((i) => i.key === 'sano')?.alert).toBeUndefined();
  });
});

describe('guardianNames', () => {
  it('sólo los nombres, separados por punto medio', () => {
    expect(
      guardianNames([
        { role: 'MADRE', name: 'Laura' },
        { role: 'PADRE', name: 'Iván' },
      ]),
    ).toBe('Laura · Iván');
  });

  it('un tutor sin nombre sale por su rol y "no hay" no sale', () => {
    expect(
      guardianNames([
        { role: 'MADRE', name: '' },
        { role: 'NINGUNO', name: '' },
      ]),
    ).toBe('Mamá');
    expect(guardianNames([])).toBe('');
  });
});
