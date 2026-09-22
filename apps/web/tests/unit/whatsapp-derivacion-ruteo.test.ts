import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Modo DERIVE: a quién le llega la consulta.
 *
 * Lo que se fija aquí es el orden de preferencia —el profesional que hace ese
 * servicio, luego el único del centro, luego el número de respaldo— y que un
 * profesional sin móvil cargado no deje la consulta en el aire: se sigue
 * nombrando, pero el aviso sale por el respaldo.
 */
const state = vi.hoisted(() => ({ rows: [] as Array<Array<Record<string, unknown>>> }));

vi.mock('@/lib/db/client', () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.from = self;
    chain.innerJoin = self;
    chain.where = self;
    chain.orderBy = self;
    chain.limit = self;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.rows.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return { db: { select: () => makeChain() } };
});

import {
  buildDerivationReply,
  formatDerivationBrief,
  resolveDerivationTarget,
} from '@/lib/whatsapp/agent/derivation';

const ANA = {
  id: 'p-ana',
  fullName: 'Ana Ruiz',
  specialty: 'Fisioterapia',
  whatsappE164: '+34600111222',
  phone: '600 11 22 33',
};
const LUIS = {
  id: 'p-luis',
  fullName: 'Luis Soto',
  specialty: 'Osteopatía',
  whatsappE164: null,
  phone: null,
};
/** Sin WhatsApp propio, pero con el teléfono ya en formato internacional. */
const EVA = {
  id: 'p-eva',
  fullName: 'Eva Gil',
  specialty: 'Readaptación',
  whatsappE164: null,
  phone: '+34611000111',
};

beforeEach(() => {
  state.rows = [];
});

describe('resolveDerivationTarget', () => {
  it('manda la consulta al profesional que hace ese servicio', async () => {
    state.rows = [
      [LUIS, ANA], // profesionales activos
      [{ id: 't-1', name: 'Fisioterapia deportiva' }], // catálogo
      [{ professionalId: 'p-ana' }], // quién lo realiza
    ];

    const target = await resolveDerivationTarget({
      tenantId: 'c1',
      treatmentName: 'fisio deportiva',
      fallbackPhone: '+34699999999',
    });

    expect(target.via).toBe('treatment');
    expect(target.professionalName).toBe('Ana Ruiz');
    expect(target.phoneE164).toBe('+34600111222');
    expect(target.treatmentName).toBe('Fisioterapia deportiva');
  });

  it('si el que corresponde no tiene móvil, avisa al respaldo pero lo nombra igual', async () => {
    state.rows = [[LUIS], [{ id: 't-2', name: 'Osteopatía' }], [{ professionalId: 'p-luis' }]];

    const target = await resolveDerivationTarget({
      tenantId: 'c1',
      treatmentName: 'osteopatía',
      fallbackPhone: '+34699999999',
    });

    expect(target.via).toBe('respaldo');
    expect(target.professionalName).toBe('Luis Soto');
    expect(target.phoneE164).toBe('+34699999999');
  });

  it('sin servicio reconocido y con un solo profesional, le llega a él', async () => {
    state.rows = [[ANA]];

    const target = await resolveDerivationTarget({ tenantId: 'c1', treatmentName: null });

    expect(target.via).toBe('unico-profesional');
    expect(target.phoneE164).toBe('+34600111222');
  });

  it('con varios profesionales y sin servicio, cae al respaldo', async () => {
    state.rows = [[ANA, LUIS]];

    const target = await resolveDerivationTarget({
      tenantId: 'c1',
      treatmentName: null,
      fallbackPhone: '0034 699 99 99 99',
    });

    expect(target.via).toBe('respaldo');
    expect(target.phoneE164).toBe('+34699999999');
    expect(target.professionalName).toBeNull();
  });

  it('un respaldo sin prefijo no se usa: no se inventa un país', async () => {
    state.rows = [[ANA, LUIS]];

    const target = await resolveDerivationTarget({
      tenantId: 'c1',
      treatmentName: null,
      fallbackPhone: '699 99 99 99',
    });

    expect(target.via).toBe('sin-destino');
    expect(target.phoneE164).toBeNull();
  });

  it('sin WhatsApp propio vale el teléfono, pero sólo si es internacional', async () => {
    state.rows = [[EVA], [{ id: 't-3', name: 'Readaptación' }], [{ professionalId: 'p-eva' }]];

    const target = await resolveDerivationTarget({ tenantId: 'c1', treatmentName: 'readaptación' });

    expect(target.via).toBe('treatment');
    expect(target.phoneE164).toBe('+34611000111');
  });

  it('el teléfono local sin prefijo NO sirve como WhatsApp', async () => {
    const sinPrefijo = { ...ANA, whatsappE164: null };
    state.rows = [[sinPrefijo]];

    const target = await resolveDerivationTarget({ tenantId: 'c1', treatmentName: null });

    // Tiene "600 11 22 33" en el teléfono: no se convierte en +600112233.
    expect(target.via).toBe('sin-destino');
    expect(target.phoneE164).toBeNull();
  });

  it('sin profesionales y sin respaldo, lo dice en vez de inventarse un destino', async () => {
    state.rows = [[]];

    const target = await resolveDerivationTarget({ tenantId: 'c1', treatmentName: 'lo que sea' });

    expect(target.via).toBe('sin-destino');
    expect(target.phoneE164).toBeNull();
  });
});

describe('el parte que recibe el profesional', () => {
  it('lleva el teléfono del paciente, el motivo y la disponibilidad', () => {
    const texto = formatDerivationBrief({
      clinicName: 'Train Movements Center',
      patientName: 'Marta López',
      patientPhoneE164: '+34611222333',
      summary: 'Consulta por molestia en el hombro derecho desde hace dos semanas.',
      treatmentName: 'Fisioterapia deportiva',
      preferredTime: 'martes por la tarde',
    });

    expect(texto).toContain('Marta López');
    expect(texto).toContain('+34611222333');
    expect(texto).toContain('hombro derecho');
    expect(texto).toContain('martes por la tarde');
    expect(texto).toContain('Fisioterapia deportiva');
    expect(texto).not.toContain('URGENTE');
  });

  it('marca la urgencia en la primera línea', () => {
    const texto = formatDerivationBrief({
      clinicName: 'Centro',
      patientPhoneE164: '+34611222333',
      summary: 'Dolor lumbar agudo desde esta mañana, no puede incorporarse.',
      urgent: true,
    });

    expect(texto.split('\n')[0]).toContain('URGENTE');
  });
});

describe('lo que se le contesta al paciente', () => {
  it('nombra al profesional cuando se supo quién es', () => {
    const texto = buildDerivationReply({
      professionalId: 'p-ana',
      professionalName: 'Ana Ruiz',
      specialty: null,
      phoneE164: '+34600111222',
      treatmentName: null,
      via: 'treatment',
    });
    expect(texto).toContain('Ana Ruiz');
  });

  it('no nombra a nadie cuando la consulta fue al respaldo', () => {
    const texto = buildDerivationReply({
      professionalId: 'p-luis',
      professionalName: 'Luis Soto',
      specialty: null,
      phoneE164: '+34699999999',
      treatmentName: null,
      via: 'respaldo',
    });
    expect(texto).not.toContain('Luis Soto');
    expect(texto).toContain('equipo');
  });
});
