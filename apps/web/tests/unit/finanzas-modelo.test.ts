import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPENSE_CATEGORIES,
  HEALTH_THRESHOLDS,
  type LedgerLine,
  agingBuckets,
  breakEven,
  bucketKeyFor,
  buildSeries,
  deltaPct,
  enumerateBuckets,
  granularityFor,
  healthReport,
  ledgerToCsv,
  linesInPeriod,
  linesTouchingRange,
  matchesFilters,
  openBalances,
  resolvePeriod,
  slugify,
  sortLedger,
  summarizeLedger,
} from '@/lib/finance/model';

/**
 * Módulo Finanzas: cómo se resuelve un período, qué cuenta en caja y qué en
 * devengo, las sumas, el punto de equilibrio y el semáforo. Es lo que la dueña
 * lee para saber si la clínica va bien, así que cada número tiene su test.
 */

let seq = 0;
function line(partial: Partial<LedgerLine> & { kind: LedgerLine['kind'] }): LedgerLine {
  seq += 1;
  const source = partial.source ?? 'entry';
  return {
    key: `${source}:${seq}`,
    source,
    sourceId: String(seq),
    concept: 'Concepto',
    counterparty: null,
    categoryId: null,
    categoryName: null,
    isFixed: false,
    amountCents: 1000,
    taxCents: 0,
    status: 'PAID',
    occurredOn: '2026-09-10',
    paidOn: '2026-09-10',
    paymentMethod: null,
    professionalId: null,
    professionalName: null,
    treatmentName: null,
    patientKey: null,
    patientName: null,
    isRecurring: false,
    notes: null,
    files: [],
    ...partial,
  };
}

const session = (over: Partial<LedgerLine> = {}) =>
  line({
    kind: 'INCOME',
    source: 'charge',
    amountCents: 4500,
    paymentMethod: 'CARD',
    professionalId: 'p1',
    professionalName: 'Dra. Ruiz',
    treatmentName: 'Fisioterapia respiratoria',
    patientKey: 'pat:1',
    patientName: 'Lucía',
    ...over,
  });

const expense = (over: Partial<LedgerLine> = {}) =>
  line({ kind: 'EXPENSE', categoryId: 'c1', categoryName: 'Alquiler', isFixed: true, ...over });

describe('resolvePeriod', () => {
  it('este mes va del 1 a hoy y compara con el mismo tramo del mes anterior', () => {
    const p = resolvePeriod('this_month', '2026-09-23');
    expect(p.from).toBe('2026-09-01');
    expect(p.to).toBe('2026-09-23');
    expect(p.previous).toEqual({ from: '2026-08-01', to: '2026-08-23' });
    expect(p.label).toBe('septiembre 2026');
  });

  it('el mes pasado es el mes entero y su anterior también', () => {
    const p = resolvePeriod('last_month', '2026-03-05');
    expect(p).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(p.previous).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('el trimestre y el año van hasta hoy y comparan a la misma altura', () => {
    expect(resolvePeriod('quarter', '2026-09-23')).toMatchObject({
      from: '2026-07-01',
      to: '2026-09-23',
      previous: { from: '2026-04-01', to: '2026-06-23' },
      label: 'T3 2026',
    });
    expect(resolvePeriod('year', '2026-09-23')).toMatchObject({
      from: '2026-01-01',
      previous: { from: '2025-01-01', to: '2025-09-23' },
    });
  });

  it('los últimos 12 meses empiezan el día 1 de hace once meses', () => {
    const p = resolvePeriod('last_12m', '2026-09-23');
    expect(p.from).toBe('2025-10-01');
    expect(p.to).toBe('2026-09-23');
    expect(p.previous.from).toBe('2024-10-01');
  });

  it('un personalizado compara con el mismo número de días justo antes', () => {
    const p = resolvePeriod('custom', '2026-09-23', { from: '2026-09-10', to: '2026-09-19' });
    expect(p.previous).toEqual({ from: '2026-08-31', to: '2026-09-09' });
  });

  it('un personalizado con las fechas al revés se endereza, y sin fechas cae a este mes', () => {
    const p = resolvePeriod('custom', '2026-09-23', { from: '2026-09-19', to: '2026-09-10' });
    expect(p).toMatchObject({ from: '2026-09-10', to: '2026-09-19' });
    expect(resolvePeriod('custom', '2026-09-23').period).toBe('this_month');
  });

  it('el día 31 comparado con un mes de 30 cae al último día', () => {
    const p = resolvePeriod('this_month', '2026-07-31');
    expect(p.previous).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });
});

describe('cubos de la serie', () => {
  it('un mes se lee por días, un trimestre por semanas y un año por meses', () => {
    expect(granularityFor({ from: '2026-09-01', to: '2026-09-23' })).toBe('day');
    expect(granularityFor({ from: '2026-07-01', to: '2026-09-23' })).toBe('week');
    expect(granularityFor({ from: '2026-01-01', to: '2026-09-23' })).toBe('month');
  });

  it('la semana empieza en lunes y el mes se enumera aunque esté vacío', () => {
    expect(bucketKeyFor('2026-09-23', 'week')).toBe('2026-09-21');
    expect(bucketKeyFor('2026-09-21', 'week')).toBe('2026-09-21');
    expect(enumerateBuckets({ from: '2025-11-15', to: '2026-02-03' }, 'month')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(enumerateBuckets({ from: '2026-09-01', to: '2026-09-03' }, 'day')).toHaveLength(3);
  });
});

describe('caja y devengo', () => {
  const lines = [
    // Factura de agosto pagada en septiembre: devengo agosto, caja septiembre.
    expense({ occurredOn: '2026-08-28', paidOn: '2026-09-02', amountCents: 80000 }),
    // Pendiente: cuenta en devengo, no en caja.
    expense({ occurredOn: '2026-09-15', paidOn: null, status: 'PENDING', amountCents: 12000 }),
    session({ occurredOn: '2026-09-10', paidOn: '2026-09-10' }),
  ];
  const september = { from: '2026-09-01', to: '2026-09-30' };

  it('en caja cuenta lo pagado por fecha de pago', () => {
    const inCash = linesInPeriod(lines, 'cash', september);
    expect(inCash.map((l) => l.amountCents)).toEqual([80000, 4500]);
  });

  it('en devengo cuenta por fecha del gasto, pagado o no', () => {
    const accrued = linesInPeriod(lines, 'accrual', september);
    expect(accrued.map((l) => l.amountCents)).toEqual([12000, 4500]);
  });

  it('Movimientos enseña lo que toca el rango por cualquiera de las dos fechas', () => {
    expect(linesTouchingRange(lines, september)).toHaveLength(3);
    expect(linesTouchingRange(lines, { from: '2026-08-01', to: '2026-08-31' })).toHaveLength(1);
  });

  it('ordena lo más reciente arriba por la fecha de la base', () => {
    const sorted = sortLedger(lines, 'accrual');
    expect(sorted.map((l) => l.occurredOn)).toEqual(['2026-09-15', '2026-09-10', '2026-08-28']);
  });
});

describe('summarizeLedger', () => {
  it('separa sesiones de otros ingresos, fijos de variables, y saca ticket medio y margen', () => {
    const s = summarizeLedger([
      session({ amountCents: 4500, paymentMethod: 'CARD' }),
      session({ amountCents: 5500, paymentMethod: 'CASH', treatmentName: 'Primera visita' }),
      line({ kind: 'INCOME', amountCents: 3000, categoryName: 'Bonos', categoryId: 'b' }),
      expense({ amountCents: 5000, isFixed: true }),
      expense({ amountCents: 1000, isFixed: false, categoryId: 'c2', categoryName: 'Material' }),
      // Sin importe: no suma ni cuenta como sesión.
      session({ amountCents: null, status: 'PENDING', paidOn: null }),
    ]);
    expect(s.incomeCents).toBe(13000);
    expect(s.expenseCents).toBe(6000);
    expect(s.netCents).toBe(7000);
    expect(s.marginPct).toBeCloseTo(53.8, 1);
    expect(s.sessions).toBe(2);
    expect(s.avgTicketCents).toBe(5000);
    expect(s.sessionsIncomeCents).toBe(10000);
    expect(s.otherIncomeCents).toBe(3000);
    expect(s.fixedCents).toBe(5000);
    expect(s.variableCents).toBe(1000);
    expect(s.incomeByMethod.map((r) => [r.name, r.cents])).toEqual([
      ['Efectivo', 5500],
      ['Tarjeta', 4500],
    ]);
    expect(s.expenseByCategory[0]).toMatchObject({ name: 'Alquiler', cents: 5000, isFixed: true });
    expect(s.incomeByTreatment.map((r) => r.name)).toEqual([
      'Primera visita',
      'Fisioterapia respiratoria',
    ]);
    expect(s.incomeByProfessional[0]).toMatchObject({ name: 'Dra. Ruiz', sessions: 2 });
  });

  it('sin ingresos el margen y el ticket son null, no cero', () => {
    const s = summarizeLedger([expense()]);
    expect(s.marginPct).toBeNull();
    expect(s.avgTicketCents).toBeNull();
  });

  it('la variación contra el anterior es null sin base con la que comparar', () => {
    expect(deltaPct(1200, 1000)).toBe(20);
    expect(deltaPct(800, 1000)).toBe(-20);
    expect(deltaPct(500, 0)).toBeNull();
  });
});

describe('saldos abiertos', () => {
  it('lo pendiente es un saldo a fecha, y una sesión atendida sin cobro es fuga', () => {
    const open = openBalances(
      [
        session({ status: 'PENDING', paidOn: null, occurredOn: '2026-06-01', amountCents: 4500 }),
        session({ source: 'appointment', status: 'PENDING', paidOn: null, amountCents: 4500 }),
        session({ status: 'PENDING', paidOn: null, amountCents: null }),
        // Futuro: todavía no es pendiente.
        session({ status: 'PENDING', paidOn: null, occurredOn: '2026-10-05' }),
        expense({ status: 'PENDING', paidOn: null, amountCents: 30000 }),
        expense(),
      ],
      '2026-09-23',
    );
    expect(open.receivables).toHaveLength(3);
    expect(open.receivableCents).toBe(9000);
    expect(open.unbilledSessions).toBe(2);
    expect(open.payables).toHaveLength(1);
    expect(open.payableCents).toBe(30000);
  });

  it('la antigüedad reparte por tramos de 30 días', () => {
    const buckets = agingBuckets(
      [
        session({ occurredOn: '2026-09-20', amountCents: 100 }),
        session({ occurredOn: '2026-08-10', amountCents: 200 }),
        session({ occurredOn: '2026-07-10', amountCents: 300 }),
        session({ occurredOn: '2026-01-10', amountCents: 400 }),
      ],
      '2026-09-23',
    );
    expect(buckets.map((b) => b.cents)).toEqual([100, 200, 300, 400]);
  });
});

describe('buildSeries', () => {
  it('rellena los cubos vacíos y acumula el resultado', () => {
    const s = buildSeries(
      [
        session({ paidOn: '2026-09-02', occurredOn: '2026-09-02', amountCents: 5000 }),
        expense({ paidOn: '2026-09-03', occurredOn: '2026-09-03', amountCents: 8000 }),
        session({ paidOn: '2026-09-04', occurredOn: '2026-09-04', amountCents: 5000 }),
      ],
      'cash',
      { from: '2026-09-01', to: '2026-09-04' },
    );
    expect(s.granularity).toBe('day');
    expect(s.points.map((p) => p.netCents)).toEqual([0, 5000, -8000, 5000]);
    expect(s.points.map((p) => p.cumulativeNetCents)).toEqual([0, 5000, -3000, 2000]);
    expect(s.points[1]?.label).toBe('2 sept');
  });
});

describe('breakEven', () => {
  it('sesiones al mes = fijos mensuales / (ticket − variable por sesión)', () => {
    const s = summarizeLedger([
      ...Array.from({ length: 10 }, () => session({ amountCents: 5000 })),
      expense({ amountCents: 100000, isFixed: true }),
      expense({ amountCents: 10000, isFixed: false }),
    ]);
    const be = breakEven(s, { from: '2026-09-01', to: '2026-09-30' });
    expect(be.months).toBeCloseTo(0.986, 2);
    expect(be.variablePerSessionCents).toBe(1000);
    expect(be.contributionCents).toBe(4000);
    // 101.400 / 4.000 → 26 sesiones
    expect(be.sessionsPerMonth).toBe(26);
    expect(be.revenuePerMonthCents).toBe(26 * 5000);
    expect(be.fixedCoverage).toBeCloseTo(0.5, 2);
  });

  it('si el ticket no cubre el variable no hay número de sesiones', () => {
    const s = summarizeLedger([
      session({ amountCents: 1000 }),
      expense({ amountCents: 2000, isFixed: false }),
      expense({ amountCents: 5000, isFixed: true }),
    ]);
    expect(breakEven(s, { from: '2026-09-01', to: '2026-09-30' }).sessionsPerMonth).toBeNull();
  });
});

describe('healthReport', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };

  it('una clínica que gana con holgura sale sana', () => {
    const current = summarizeLedger([
      ...Array.from({ length: 40 }, () => session({ amountCents: 5000 })),
      expense({ amountCents: 60000, isFixed: true }),
      expense({ amountCents: 20000, isFixed: false }),
    ]);
    const previous = summarizeLedger(Array.from({ length: 35 }, () => session()));
    const open = openBalances([], '2026-09-30');
    const r = healthReport({ current, previous, open, breakEven: breakEven(current, range) });
    expect(r.overall).toBe('healthy');
    expect(r.signals.find((s) => s.key === 'margin')?.level).toBe('ok');
    expect(r.signals.find((s) => s.key === 'growth')?.level).toBe('ok');
    expect(r.signals.find((s) => s.key === 'unbilled')?.level).toBe('ok');
    expect(r.signals.find((s) => s.key === 'concentration')?.level).toBe('na');
    expect(r.score).toBeGreaterThan(80);
  });

  it('gastar más de lo que entra, con cobros viejos y sesiones sin cobrar, es riesgo', () => {
    const current = summarizeLedger([
      ...Array.from({ length: 10 }, () => session({ amountCents: 4000 })),
      expense({ amountCents: 50000, isFixed: true }),
    ]);
    const previous = summarizeLedger(Array.from({ length: 20 }, () => session()));
    const open = openBalances(
      [
        ...Array.from({ length: 5 }, () =>
          session({ source: 'appointment', status: 'PENDING', paidOn: null, amountCents: 4000 }),
        ),
      ],
      '2026-09-30',
    );
    const r = healthReport({ current, previous, open, breakEven: breakEven(current, range) });
    expect(r.overall).toBe('risk');
    expect(r.signals.find((s) => s.key === 'margin')?.level).toBe('bad');
    expect(r.signals.find((s) => s.key === 'growth')?.level).toBe('bad');
    expect(r.signals.find((s) => s.key === 'receivables')?.level).toBe('bad');
    expect(r.signals.find((s) => s.key === 'coverage')?.level).toBe('bad');
    expect(r.signals.find((s) => s.key === 'unbilled')?.level).toBe('bad');
  });

  it('un solo profesional que lo factura casi todo enciende la dependencia', () => {
    const current = summarizeLedger([
      ...Array.from({ length: 9 }, () => session()),
      session({ professionalId: 'p2', professionalName: 'Dr. Vega' }),
    ]);
    const r = healthReport({
      current,
      previous: current,
      open: openBalances([], '2026-09-30'),
      breakEven: breakEven(current, range),
    });
    const c = r.signals.find((s) => s.key === 'concentration');
    expect(c?.level).toBe('bad');
    expect(c?.value).toBe('Dra. Ruiz: 90 %');
    expect(HEALTH_THRESHOLDS.concentration.warn).toBe(85);
  });

  it('sin datos no inventa un veredicto', () => {
    const empty = summarizeLedger([]);
    const r = healthReport({
      current: empty,
      previous: empty,
      open: openBalances([], '2026-09-30'),
      breakEven: breakEven(empty, range),
    });
    // Sólo "sesiones sin cobro" tiene dato (cero): una señal verde y nada más.
    expect(r.signals.filter((s) => s.level !== 'na').map((s) => s.key)).toEqual(['unbilled']);
    expect(r.overall).toBe('healthy');
  });
});

describe('filtros y utilidades', () => {
  it('matchesFilters cruza tipo, estado, categoría, método, origen y texto', () => {
    const l = session({ paymentMethod: 'BIZUM' });
    expect(matchesFilters(l, { kind: 'INCOME' })).toBe(true);
    expect(matchesFilters(l, { kind: 'EXPENSE' })).toBe(false);
    expect(matchesFilters(l, { method: 'BIZUM', source: 'sessions' })).toBe(true);
    expect(matchesFilters(l, { source: 'entries' })).toBe(false);
    expect(matchesFilters(l, { q: 'lucía' })).toBe(true);
    expect(matchesFilters(l, { q: 'alquiler' })).toBe(false);
    expect(matchesFilters(l, { professionalId: 'p9' })).toBe(false);
  });

  it('slugify quita acentos y deja una clave estable', () => {
    expect(slugify('Gestoría y asesoría')).toBe('gestoria-y-asesoria');
    expect(slugify('  Luz / Agua  ')).toBe('luz-agua');
    expect(new Set(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.slug)).size).toBe(
      DEFAULT_EXPENSE_CATEGORIES.length,
    );
  });

  it('el CSV va con punto y coma, coma decimal y BOM para Excel', () => {
    const csv = ledgerToCsv([
      expense({ concept: 'Alquiler "local"; septiembre', amountCents: 80050 }),
    ]);
    expect(csv.startsWith('﻿Fecha;')).toBe(true);
    expect(csv).toContain('"Alquiler ""local""; septiembre"');
    expect(csv).toContain(';800,50;');
  });
});
