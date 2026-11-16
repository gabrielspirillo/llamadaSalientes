import { financeInsights, medianPrice, monthForecast } from '@/lib/finance/insights';
import {
  type FinanceSummary,
  type LedgerLine,
  type OpenBalances,
  breakEven,
} from '@/lib/finance/model';
import { describe, expect, it } from 'vitest';

function summary(p: Partial<FinanceSummary> = {}): FinanceSummary {
  return {
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    marginPct: null,
    sessions: 0,
    avgTicketCents: null,
    sessionsIncomeCents: 0,
    otherIncomeCents: 0,
    fixedCents: 0,
    variableCents: 0,
    incomeByMethod: [],
    expenseByCategory: [],
    incomeByCategory: [],
    incomeByProfessional: [],
    incomeByTreatment: [],
    ...p,
  };
}

const noOpen: OpenBalances = {
  receivables: [],
  receivableCents: 0,
  unbilledSessions: 0,
  payables: [],
  payableCents: 0,
};
const noAging = [
  { label: '0–30 días', count: 0, cents: 0 },
  { label: '31–60 días', count: 0, cents: 0 },
  { label: '61–90 días', count: 0, cents: 0 },
  { label: 'Más de 90 días', count: 0, cents: 0 },
];
const period = { from: '2026-11-01', to: '2026-11-16' };

function base(over: Partial<Parameters<typeof financeInsights>[0]> = {}) {
  const current = over.current ?? summary();
  return {
    current,
    previous: summary(),
    open: noOpen,
    breakEven: breakEven(current, period),
    aging: noAging,
    periodLabel: 'este mes',
    previousLabel: 'octubre 2026',
    todayKey: '2026-11-16',
    anyExpenseRecorded: true,
    unpricedTreatments: 0,
    listPriceCents: null,
    monthlyGoalCents: null,
    forecast: null,
    hrefs: {
      pendingIncome: '/p',
      pendingExpense: '/e',
      treatments: '/t',
      agenda: '/a',
      category: (id: string) => `/c/${id}`,
    },
    ...over,
  };
}

describe('financeInsights', () => {
  it('sin gastos apuntados lo primero es apuntarlos', () => {
    const current = summary({
      incomeCents: 194500,
      netCents: 194500,
      sessions: 47,
      avgTicketCents: 4138,
    });
    const out = financeInsights(base({ current, anyExpenseRecorded: false }));
    expect(out[0]?.key).toBe('no_expenses');
    expect(out[0]?.action).toEqual({ kind: 'new-expense', label: 'Añadir un gasto' });
    expect(out[0]?.body).toContain('1.945,00');
  });

  it('las sesiones sin cobro se valoran al ticket medio', () => {
    const current = summary({ incomeCents: 100000, sessions: 25, avgTicketCents: 4000 });
    const out = financeInsights(base({ current, open: { ...noOpen, unbilledSessions: 10 } }));
    const u = out.find((i) => i.key === 'unbilled');
    expect(u?.tone).toBe('urgent');
    expect(u?.impactCents).toBe(40000);
  });

  it('una caída de ingresos dice si es por sesiones o por precio', () => {
    const current = summary({ incomeCents: 60000, sessions: 15, avgTicketCents: 4000 });
    const previous = summary({ incomeCents: 100000, sessions: 25, avgTicketCents: 4000 });
    const drop = financeInsights(base({ current, previous })).find((i) => i.key === 'income_drop');
    expect(drop?.title).toContain('40 %');
    expect(drop?.body).toContain('el número de sesiones');
  });

  it('avisa si el ticket medio está por debajo de la tarifa', () => {
    const current = summary({ incomeCents: 70000, sessions: 20, avgTicketCents: 3500 });
    const t = financeInsights(base({ current, listPriceCents: 4500 })).find(
      (i) => i.key === 'ticket_below_list',
    );
    expect(t?.impactCents).toBe(20000);
  });

  it('la previsión por debajo del objetivo calcula las sesiones que faltan', () => {
    const current = summary({ incomeCents: 200000, sessions: 50, avgTicketCents: 4000 });
    const forecast = monthForecast({
      soFarCents: 200000,
      upcoming: { count: 10, knownCents: 0, unpricedCount: 10 },
      avgTicketCents: 4000,
    });
    expect(forecast.projectedCents).toBe(240000);
    const f = financeInsights(base({ current, forecast, monthlyGoalCents: 300000 })).find(
      (i) => i.key === 'forecast_short',
    );
    expect(f?.body).toContain('15 sesiones');
  });

  it('lo urgente va antes que lo que va bien', () => {
    const current = summary({ incomeCents: 150000, sessions: 30, avgTicketCents: 5000 });
    const previous = summary({ incomeCents: 100000, sessions: 20, avgTicketCents: 5000 });
    const aged = [...noAging];
    aged[1] = { label: '31–60 días', count: 2, cents: 10000 };
    const out = financeInsights(base({ current, previous, aging: aged }));
    expect(out.map((i) => i.tone)).toEqual(['urgent', 'good']);
  });

  it('un gasto pendiente de días anteriores se recuerda', () => {
    const line = { occurredOn: '2026-11-02', amountCents: 50000 } as LedgerLine;
    const out = financeInsights(
      base({ open: { ...noOpen, payables: [line], payableCents: 50000 } }),
    );
    expect(out.find((i) => i.key === 'payables')?.body).toContain('500,00');
  });
});

describe('medianPrice', () => {
  it('ignora los tratamientos sin precio', () => {
    expect(medianPrice([null, 4000, 5000, null])).toBe(4500);
    expect(medianPrice([null])).toBeNull();
  });
});
