import { describe, expect, it } from 'vitest';

import {
  buildBillingLines,
  centsToInput,
  describeConcept,
  formatCents,
  inferChargeFileKind,
  parseAmountToCents,
  summarizeBilling,
} from '@/lib/agenda/billing';

/**
 * La pestaña Contable de la ficha: cómo se unen citas y cargos, qué se suma y
 * cómo se lee un importe tecleado a mano.
 */

const d = (iso: string) => new Date(iso);

describe('parseAmountToCents', () => {
  it('lee coma o punto como decimal', () => {
    expect(parseAmountToCents('45')).toBe(4500);
    expect(parseAmountToCents('45,50')).toBe(4550);
    expect(parseAmountToCents('45.5')).toBe(4550);
    expect(parseAmountToCents('45 €')).toBe(4500);
    expect(parseAmountToCents(45.5)).toBe(4550);
  });

  it('entiende los miles a la española', () => {
    expect(parseAmountToCents('1.250,00')).toBe(125000);
    expect(parseAmountToCents('1.250')).toBe(125000);
    expect(parseAmountToCents('1,250.00')).toBe(125000);
  });

  it('rechaza lo que no es un importe', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents(null)).toBeNull();
    expect(parseAmountToCents(Number.NaN)).toBeNull();
  });
});

describe('formato', () => {
  it('pinta euros a la española y vuelve al campo con coma', () => {
    expect(formatCents(4500).replace(/ /g, ' ')).toBe('45,00 €');
    expect(centsToInput(4550)).toBe('45,50');
    expect(centsToInput(null)).toBe('');
  });

  it('el concepto lleva tratamiento, profesional y si fue primera visita', () => {
    expect(
      describeConcept({
        treatmentName: 'Fisioterapia respiratoria',
        professionalName: 'Dra. Ruiz',
        isFirstVisit: true,
      }),
    ).toBe('Fisioterapia respiratoria · Dra. Ruiz · 1ª visita');
    expect(
      describeConcept({ treatmentName: null, professionalName: 'Dra. Ruiz', isFirstVisit: false }),
    ).toBe('Sesión · Dra. Ruiz');
  });

  it('un PDF es una factura; una foto, un justificante', () => {
    expect(inferChargeFileKind('application/pdf')).toBe('INVOICE');
    expect(inferChargeFileKind('image/jpeg')).toBe('PROOF');
  });
});

describe('buildBillingLines', () => {
  const appointments = [
    {
      id: 'a3',
      startsAt: d('2026-09-22T15:30:00Z'),
      status: 'CONFIRMED',
      concept: 'Fisioterapia · Dra. Ruiz',
      treatmentPriceCents: 4500,
    },
    {
      id: 'a2',
      startsAt: d('2026-03-14T09:00:00Z'),
      status: 'COMPLETED',
      concept: 'Fisioterapia · Dra. Ruiz',
      treatmentPriceCents: 4500,
    },
    {
      id: 'a1',
      startsAt: d('2026-03-12T16:30:00Z'),
      status: 'COMPLETED',
      concept: 'Fisioterapia · Dra. Ruiz · 1ª visita',
      treatmentPriceCents: 4500,
    },
    {
      id: 'a0',
      startsAt: d('2026-03-01T10:00:00Z'),
      status: 'CANCELLED',
      concept: 'Fisioterapia · Dra. Ruiz',
      treatmentPriceCents: 4500,
    },
  ];
  const charges = [
    {
      id: 'c2',
      appointmentId: 'a2',
      concept: 'Fisioterapia · Dra. Ruiz',
      amountCents: 4500,
      status: 'PAID',
      paymentMethod: 'CARD',
      paidOn: '2026-03-14',
      createdAt: d('2026-03-14T10:00:00Z'),
      files: [{ id: 'f1', name: 'F-2026-0087.pdf', kind: 'INVOICE' as const }],
    },
    {
      id: 'c1',
      appointmentId: 'a1',
      concept: 'Fisioterapia · Dra. Ruiz · 1ª visita',
      amountCents: 5500,
      status: 'PAID',
      paymentMethod: 'BIZUM',
      paidOn: '2026-03-12',
      createdAt: d('2026-03-12T17:00:00Z'),
      files: [],
    },
  ];

  it('una cita sin cargo sale pendiente con el precio del tratamiento', () => {
    const lines = buildBillingLines({ appointments, charges });
    const a3 = lines.find((l) => l.appointmentId === 'a3');
    expect(a3).toMatchObject({
      key: 'a3',
      chargeId: null,
      status: 'PENDING',
      amountCents: 4500,
      files: [],
    });
  });

  it('el cargo manda sobre la cita: importe, método, fecha y comprobantes', () => {
    const lines = buildBillingLines({ appointments, charges });
    expect(lines.find((l) => l.appointmentId === 'a1')).toMatchObject({
      key: 'c1',
      chargeId: 'c1',
      amountCents: 5500,
      status: 'PAID',
      paymentMethod: 'BIZUM',
      paidOn: '2026-03-12',
    });
    expect(lines.find((l) => l.appointmentId === 'a2')?.files).toHaveLength(1);
  });

  it('una cita cancelada sin cargo no sale; con cargo sí', () => {
    expect(buildBillingLines({ appointments, charges }).some((l) => l.appointmentId === 'a0')).toBe(
      false,
    );
    const paidCancelled = {
      ...charges[0]!,
      id: 'c0',
      appointmentId: 'a0',
    };
    const lines = buildBillingLines({ appointments, charges: [...charges, paidCancelled] });
    expect(lines.some((l) => l.appointmentId === 'a0' && l.chargeId === 'c0')).toBe(true);
  });

  it('un cargo suelto se lista por su cuenta y todo va de más reciente a más antiguo', () => {
    const loose = {
      id: 'c9',
      appointmentId: null,
      concept: 'Informe para el colegio',
      amountCents: 2000,
      status: 'PENDING',
      paymentMethod: null,
      paidOn: null,
      createdAt: d('2026-05-01T10:00:00Z'),
      files: [],
    };
    const lines = buildBillingLines({ appointments, charges: [...charges, loose] });
    expect(lines.map((l) => l.key)).toEqual(['a3', 'c9', 'c2', 'c1']);
  });

  it('un cargo sin importe no cuenta en lo facturado pero sí en lo pendiente', () => {
    const noAmount = {
      id: 'c3',
      appointmentId: 'a3',
      concept: 'Fisioterapia · Dra. Ruiz',
      amountCents: null,
      status: 'PENDING',
      paymentMethod: null,
      paidOn: null,
      createdAt: d('2026-09-22T16:00:00Z'),
      files: [],
    };
    const lines = buildBillingLines({ appointments, charges: [...charges, noAmount] });
    expect(lines.find((l) => l.appointmentId === 'a3')?.amountCents).toBeNull();
    expect(summarizeBilling(lines)).toEqual({
      billedCents: 10000,
      paidCents: 10000,
      dueCents: 0,
      dueCount: 1,
    });
  });

  it('las sumas: facturado, cobrado y la resta', () => {
    const lines = buildBillingLines({ appointments, charges });
    expect(summarizeBilling(lines)).toEqual({
      billedCents: 14500,
      paidCents: 10000,
      dueCents: 4500,
      dueCount: 1,
    });
  });
});
