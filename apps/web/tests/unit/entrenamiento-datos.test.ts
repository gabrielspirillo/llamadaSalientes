import { describe, expect, it } from 'vitest';

import {
  type ClinicDataContext,
  describeDataChange,
  parseAmount,
  parseDataChanges,
} from '@/lib/agent-training/data-changes';

const CTX: ClinicDataContext = {
  treatments: [
    {
      id: 't-limpieza',
      name: 'Limpieza dental',
      description: 'Profilaxis y revisión',
      durationMinutes: 30,
      priceMin: 50,
      priceMax: 50,
      currency: 'EUR',
      active: true,
    },
    {
      id: 't-blanqueamiento',
      name: 'Blanqueamiento',
      description: null,
      durationMinutes: 60,
      priceMin: 200,
      priceMax: 350,
      currency: 'EUR',
      active: true,
    },
  ],
  faqs: [
    { id: 'f-seguros', category: 'Pagos', question: '¿Aceptáis seguros?', answer: 'Sólo Adeslas.' },
  ],
  clinic: { address: 'Calle Mayor 1', phones: ['+34910000000'], transferNumber: null },
};

describe('parseAmount', () => {
  it('lee el precio como lo dicta una clínica española', () => {
    expect(parseAmount('60')).toBe(60);
    expect(parseAmount('60,50')).toBe(60.5);
    expect(parseAmount('60.50')).toBe(60.5);
    expect(parseAmount('1.250,00')).toBe(1250);
    expect(parseAmount('1,250.00')).toBe(1250);
    expect(parseAmount('60 €')).toBe(60);
    expect(parseAmount(45)).toBe(45);
  });

  it('lo ilegible o negativo es null, no cero', () => {
    expect(parseAmount('bajo consulta')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(-10)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('parseDataChanges — tratamientos', () => {
  it('cambia el precio y arma el antes → después', () => {
    const [c] = parseDataChanges(
      [{ entity: 'TREATMENT', op: 'UPDATE', target_id: 't-limpieza', price_min: '60' }],
      'm',
      CTX,
    );
    expect(c?.op).toBe('UPDATE');
    expect(c?.targetId).toBe('t-limpieza');
    expect(c?.fields.priceMin).toBe(60);
    // Un precio único no puede quedarse sin máximo: el asistente diría "desde 60 €".
    expect(c?.fields.priceMax).toBe(60);
    const precio = c?.diff.find((d) => d.label === 'Precio');
    expect(precio?.before).toBe('50 EUR');
    expect(precio?.after).toBe('60 EUR');
  });

  it('respeta la horquilla cuando vienen los dos', () => {
    const [c] = parseDataChanges(
      [
        {
          entity: 'TREATMENT',
          op: 'UPDATE',
          target_id: 't-blanqueamiento',
          price_min: '250',
          price_max: '400',
        },
      ],
      'm',
      CTX,
    );
    expect(c?.diff[0]?.after).toBe('250-400 EUR');
  });

  it('un id inventado se descarta: pulsar esa tarjeta fallaría', () => {
    expect(
      parseDataChanges(
        [{ entity: 'TREATMENT', op: 'UPDATE', target_id: 't-que-no-existe', price_min: '99' }],
        'm',
        CTX,
      ),
    ).toEqual([]);
  });

  it('un cambio que no cambia nada no se propone', () => {
    expect(
      parseDataChanges(
        [{ entity: 'TREATMENT', op: 'UPDATE', target_id: 't-limpieza', price_min: '50' }],
        'm',
        CTX,
      ),
    ).toEqual([]);
  });

  it('"ya no lo hacemos" desactiva, y sobre uno ya apagado no propone nada', () => {
    const [c] = parseDataChanges(
      [{ entity: 'TREATMENT', op: 'DEACTIVATE', target_id: 't-blanqueamiento' }],
      'm',
      CTX,
    );
    expect(c?.op).toBe('DEACTIVATE');
    expect(c?.fields.active).toBe(false);
    expect(describeDataChange(c!)).toBe('Dejar de ofrecer "Blanqueamiento"');

    const apagado: ClinicDataContext = {
      ...CTX,
      treatments: CTX.treatments.map((t) => ({ ...t, active: false })),
    };
    expect(
      parseDataChanges(
        [{ entity: 'TREATMENT', op: 'DEACTIVATE', target_id: 't-blanqueamiento' }],
        'm',
        apagado,
      ),
    ).toEqual([]);
  });

  it('al crear exige nombre y duración', () => {
    expect(
      parseDataChanges([{ entity: 'TREATMENT', op: 'CREATE', name: 'Ortodoncia' }], 'm', CTX),
    ).toEqual([]);
    const [c] = parseDataChanges(
      [
        {
          entity: 'TREATMENT',
          op: 'CREATE',
          name: 'Ortodoncia',
          duration_minutes: 45,
          price_min: '1.500',
        },
      ],
      'm',
      CTX,
    );
    expect(c?.op).toBe('CREATE');
    expect(c?.fields.durationMinutes).toBe(45);
    expect(c?.fields.priceMin).toBe(1500);
  });
});

describe('parseDataChanges — FAQs y clínica', () => {
  it('edita una respuesta existente', () => {
    const [c] = parseDataChanges(
      [
        {
          entity: 'FAQ',
          op: 'UPDATE',
          target_id: 'f-seguros',
          answer: 'Trabajamos con Adeslas y Sanitas.',
        },
      ],
      'm',
      CTX,
    );
    expect(c?.entity).toBe('FAQ');
    expect(c?.fields.answer).toBe('Trabajamos con Adeslas y Sanitas.');
    expect(c?.diff[0]?.before).toBe('Sólo Adeslas.');
  });

  it('crear una FAQ necesita pregunta y respuesta', () => {
    expect(
      parseDataChanges([{ entity: 'FAQ', op: 'CREATE', question: '¿Hay parking?' }], 'm', CTX),
    ).toEqual([]);
  });

  it('borrar una FAQ inexistente no propone nada', () => {
    expect(
      parseDataChanges([{ entity: 'FAQ', op: 'DELETE', target_id: 'f-nope' }], 'm', CTX),
    ).toEqual([]);
  });

  it('los teléfonos llegan en lista o separados por comas', () => {
    const [c] = parseDataChanges(
      [{ entity: 'CLINIC', op: 'UPDATE', phones: '+34910000000, +34600111222' }],
      'm',
      CTX,
    );
    expect(c?.fields.phones).toEqual(['+34910000000', '+34600111222']);
  });

  it('sin diferencias con lo que ya hay, no hay tarjeta', () => {
    expect(
      parseDataChanges([{ entity: 'CLINIC', op: 'UPDATE', address: 'Calle Mayor 1' }], 'm', CTX),
    ).toEqual([]);
  });
});

describe('parseDataChanges — forma', () => {
  it('numera las refs y corta en seis', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => ({
      entity: 'FAQ',
      op: 'CREATE',
      question: `¿Pregunta ${i}?`,
      answer: `Respuesta ${i}.`,
    }));
    const out = parseDataChanges(muchos, 'msg', CTX);
    expect(out).toHaveLength(6);
    expect(out[0]?.ref).toBe('msg-d0');
    expect(out[5]?.ref).toBe('msg-d5');
  });

  it('lo que no es un array, o una entidad desconocida, se ignora', () => {
    expect(parseDataChanges(undefined, 'm', CTX)).toEqual([]);
    expect(parseDataChanges([{ entity: 'OTRA_COSA', op: 'UPDATE' }], 'm', CTX)).toEqual([]);
  });
});
