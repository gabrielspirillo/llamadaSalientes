import { describe, expect, it } from 'vitest';

import {
  EMPTY_BOOKING_POLICY,
  activeGuardians,
  anamnesisConflicts,
  describePriority,
  describeWatchouts,
  formatWatchout,
  groupAnamnesis,
  guardianNames,
  parseAnamnesisTemplate,
  parseBookingPolicy,
  parseGuardians,
  primaryGuardian,
} from '@/lib/care-profile/policy';

/**
 * La cabecera y la anamnesis de la ficha rediseñada: quiénes son los tutores,
 * qué hay que tener en cuenta antes de atender, qué se contradice y de dónde
 * sale la prioridad.
 */

const template = parseAnamnesisTemplate([
  { key: 'sano', label: 'Sano', group: 'Antecedentes médicos', exclusive: true, noDetail: true },
  { key: 'prematuro', label: 'Prematuro', group: 'Perinatal', alert: true },
  { key: 'ingresos', label: 'Ingresos', group: 'Antecedentes médicos', alert: true },
  { key: 'alergias', label: 'Alergias', group: 'Antecedentes médicos', alert: true },
  { key: 'hermanos', label: 'Hermanos', group: 'Entorno' },
]);

describe('describeWatchouts', () => {
  it('sólo los "sí" de los ítems marcados como alerta, con su detalle', () => {
    const out = describeWatchouts(template, {
      prematuro: { value: true, detail: '34 semanas' },
      ingresos: { value: true, detail: '' },
      alergias: { value: false, detail: '' },
      hermanos: { value: true, detail: '1 hermano' },
    });
    expect(out.map(formatWatchout)).toEqual(['Prematuro: 34 semanas', 'Ingresos']);
    expect(out[0]).toMatchObject({ key: 'prematuro', source: 'ANAMNESIS', detail: '34 semanas' });
  });

  it('el motivo de la prioridad manual va primero', () => {
    const out = describeWatchouts(
      template,
      { prematuro: { value: true, detail: '' } },
      { priorityFlag: true, priorityReason: 'Bronquiolitis de repetición' },
    );
    expect(out.map(formatWatchout)).toEqual([
      'Prioritario: Bronquiolitis de repetición',
      'Prematuro',
    ]);
  });

  it('sin marca, el motivo no cuenta; sin nada, la lista queda vacía', () => {
    expect(
      describeWatchouts(template, {}, { priorityFlag: false, priorityReason: 'Viejo motivo' }),
    ).toEqual([]);
  });

  it('la plantilla acepta las claves nuevas y las conserva', () => {
    expect(template.find((i) => i.key === 'prematuro')?.alert).toBe(true);
    expect(template.find((i) => i.key === 'sano')).toMatchObject({
      exclusive: true,
      noDetail: true,
      group: 'Antecedentes médicos',
    });
  });
});

describe('anamnesisConflicts', () => {
  it('avisa cuando "Sano: sí" convive con una alerta en sí', () => {
    const out = anamnesisConflicts(template, {
      sano: { value: true, detail: '' },
      ingresos: { value: true, detail: 'bronquiolitis' },
      prematuro: { value: true, detail: '' },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"Sano: sí"');
    expect(out[0]).toContain('"Prematuro: sí"');
    expect(out[0]).toContain('"Ingresos: sí"');
  });

  it('no avisa si el exclusivo está en no o sin contestar', () => {
    expect(
      anamnesisConflicts(template, {
        sano: { value: false, detail: '' },
        ingresos: { value: true, detail: '' },
      }),
    ).toEqual([]);
    expect(anamnesisConflicts(template, { ingresos: { value: true, detail: '' } })).toEqual([]);
  });
});

describe('groupAnamnesis', () => {
  it('agrupa por bloque en el orden de primera aparición', () => {
    const groups = groupAnamnesis(template);
    expect(groups.map((g) => g.group)).toEqual(['Antecedentes médicos', 'Perinatal', 'Entorno']);
    expect(groups[0]?.items.map((i) => i.key)).toEqual(['sano', 'ingresos', 'alergias']);
  });

  it('una plantilla sin bloques queda en un único grupo sin nombre', () => {
    const plain = parseAnamnesisTemplate([
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ]);
    expect(groupAnamnesis(plain)).toEqual([{ group: null, items: plain }]);
  });
});

describe('tutores', () => {
  const guardians = parseGuardians([
    { role: 'MADRE', name: 'Laura', phone: '+34600000001', primary: true },
    { role: 'PADRE', name: 'Iván', phone: '+34600000002' },
    { role: 'NINGUNO', name: '' },
  ]);

  it('los nombres para la cabecera, sin "no hay"', () => {
    expect(guardianNames(guardians)).toBe('Laura · Iván');
    expect(guardianNames([{ role: 'MADRE', name: '' }])).toBe('Mamá');
  });

  it('el titular del teléfono es el marcado; "no hay" no cuenta como tutor', () => {
    expect(activeGuardians(guardians)).toHaveLength(2);
    expect(primaryGuardian(guardians)?.name).toBe('Laura');
    expect(primaryGuardian([{ role: 'PADRE', name: 'Iván' }])).toBeNull();
  });

  it('acepta relaciones nuevas y canal preferido', () => {
    const parsed = parseGuardians([
      { role: 'ABUELA', name: 'Carmen', channel: 'CALL' },
      { role: 'TUTOR', name: 'Servicios sociales', email: 'ss@example.org' },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.channel).toBe('CALL');
  });
});

describe('describePriority', () => {
  const policy = parseBookingPolicy({ priorityAgeMonths: { veryHighMax: 6, highMax: 24 } });

  it('por edad: dice hasta qué mes', () => {
    expect(describePriority({ ageMonths: 20, priorityFlag: false }, policy)).toEqual({
      level: 'HIGH',
      source: 'AGE',
      reason: 'por edad (hasta 24 meses)',
    });
    expect(describePriority({ ageMonths: 3, priorityFlag: false }, policy).reason).toBe(
      'por edad (hasta 6 meses)',
    );
  });

  it('a mano: con su motivo; y las dos cosas a la vez', () => {
    expect(
      describePriority({ ageMonths: 40, priorityFlag: true, priorityReason: 'asma' }, policy),
    ).toEqual({ level: 'HIGH', source: 'MANUAL', reason: 'marcado a mano: asma' });
    expect(describePriority({ ageMonths: 3, priorityFlag: true }, policy)).toMatchObject({
      level: 'VERY_HIGH',
      source: 'BOTH',
    });
  });

  it('sin regla de edad ni marca, normal y sin motivo', () => {
    expect(describePriority({ ageMonths: 3, priorityFlag: false }, EMPTY_BOOKING_POLICY)).toEqual({
      level: 'NORMAL',
      source: null,
      reason: null,
    });
  });
});
