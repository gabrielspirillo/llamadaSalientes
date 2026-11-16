import { EntryDialog } from '@/components/finanzas/entry-dialog';
import { Donut, FlowChart } from '@/components/finanzas/fin-charts';
import { FinanceFilters } from '@/components/finanzas/finance-filters';
import {
  AgingCard,
  CostStructureCard,
  DiagnosisCard,
  InsightsCard,
  PulseHero,
  RankList,
  finColor,
} from '@/components/finanzas/resumen-blocks';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import { financeInsights, medianPrice, monthForecast } from '@/lib/finance/insights';
import {
  FINANCE_BASIS_LABELS,
  type LedgerLine,
  agingBuckets,
  breakEven,
  buildSeries,
  healthReport,
  linesInPeriod,
  matchesFilters,
  monthsInRange,
  openBalances,
  plural,
  summarizeLedger,
} from '@/lib/finance/model';
import { type FinanceParams, financeHref } from '@/lib/finance/params';
import type {
  CounterpartySuggestion,
  FinanceCategoryRecord,
  FinanceOutlook,
  FinanceProfessional,
  FinanceSettingsRecord,
} from '@/lib/finance/queries';
import { CreditCard, PieChart, Plus, Stethoscope, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';

const METHOD_COLOR: Record<string, string> = {
  CARD: '#3d8f78',
  CASH: '#d79a4e',
  BIZUM: '#7aa6c2',
  TRANSFER: '#b48fc8',
  DIRECT_DEBIT: '#9bb87a',
};

/**
 * La pestaña Resumen: cómo va la clínica y qué haría ahora. Todo sale del
 * libro ya cargado (más `outlook`: citas del resto del mes y si el catálogo y
 * los gastos están completos). Orden de lectura: el resultado arriba, lo que
 * hay que hacer, y después el detalle.
 */
export function ResumenTab({
  params,
  ledger,
  categories,
  professionals,
  counterparties,
  settings,
  todayKey,
  outlook,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  counterparties: CounterpartySuggestion[];
  settings: FinanceSettingsRecord;
  todayKey: string;
  outlook?: FinanceOutlook | null;
}) {
  const { period, basis } = params;
  const filters = { professionalId: params.filters.professionalId };
  const scoped = ledger.filter((l) => matchesFilters(l, filters));

  const current = summarizeLedger(linesInPeriod(scoped, basis, period));
  const previous = summarizeLedger(linesInPeriod(scoped, basis, period.previous));
  const open = openBalances(scoped, period.to);
  const series = buildSeries(scoped, basis, period);
  const be = breakEven(current, period);
  const health = healthReport({ current, previous, open, breakEven: be });
  const aging = agingBuckets(open.receivables, todayKey);

  const goalCents = settings.monthlyRevenueGoalCents;
  const goalForPeriod = goalCents
    ? goalCents * Math.max(1, Math.round(monthsInRange(period)))
    : null;
  const forecast =
    period.period === 'this_month' && outlook
      ? monthForecast({
          soFarCents: current.incomeCents,
          upcoming: outlook.upcoming,
          avgTicketCents: current.avgTicketCents ?? previous.avgTicketCents,
        })
      : null;

  const href = (override: Record<string, string | null>) =>
    financeHref(params, { tab: 'movimientos', ...override });
  const pendingIncome = href({
    kind: 'INCOME',
    status: 'PENDING',
    period: 'last_12m',
    from: null,
    to: null,
  });
  const insights = financeInsights({
    current,
    previous,
    open,
    breakEven: be,
    aging,
    periodLabel: period.label.toLowerCase(),
    previousLabel: period.previousLabel,
    todayKey,
    anyExpenseRecorded:
      (outlook?.anyExpenseRecorded ?? false) || scoped.some((l) => l.kind === 'EXPENSE'),
    unpricedTreatments: outlook?.unpricedTreatments ?? 0,
    listPriceCents: medianPrice(outlook?.listPrices ?? []),
    monthlyGoalCents: goalCents,
    forecast,
    hrefs: {
      pendingIncome,
      pendingExpense: href({
        kind: 'EXPENSE',
        status: 'PENDING',
        period: 'last_12m',
        from: null,
        to: null,
      }),
      treatments: '/dashboard/treatments',
      agenda: '/dashboard/agenda',
      category: (id) => href({ kind: 'EXPENSE', category: id }),
    },
  });

  const isEmpty =
    current.incomeCents === 0 &&
    current.expenseCents === 0 &&
    open.receivables.length === 0 &&
    open.payables.length === 0;

  const activeCategories = categories.filter((c) => c.active);
  const activeProfessionals = professionals.filter((p) => p.active);
  const categoryIndex = new Map(categories.map((c, i) => [c.id, i]));
  const professionalIndex = new Map(professionals.map((p, i) => [p.id, i]));
  const showProfessionals = current.incomeByProfessional.length >= 2;

  const incomeItems = [
    ...current.incomeByTreatment.map((r, i) => ({
      id: r.id,
      name: r.name,
      cents: r.cents,
      hint: plural(r.sessions, 'sesión', 'sesiones'),
      color: finColor(i),
    })),
    ...current.incomeByCategory
      .filter((r) => r.id !== 'sessions')
      .map((r) => ({
        id: `cat:${r.id}`,
        name: r.name,
        cents: r.cents,
        hint: plural(r.count, 'movimiento', 'movimientos'),
        color: '#c9d1ce',
      })),
  ];

  return (
    <>
      <FinanceFilters
        params={params}
        categories={activeCategories}
        professionals={activeProfessionals}
        show={{ basis: true, professional: true }}
      />

      {isEmpty && (
        <Card className="mb-6">
          <EmptyState
            icon={<PieChart className="h-5 w-5" />}
            title={`Sin movimientos en ${period.label}`}
            description="Registra los gastos de la clínica y cobra las sesiones desde la ficha de cada paciente: con eso el resumen se llena solo. Si ya tienes datos, prueba con otro período."
            action={
              <>
                <EntryDialog
                  mode="create"
                  categories={activeCategories}
                  professionals={activeProfessionals}
                  counterparties={counterparties}
                  todayKey={todayKey}
                  trigger={
                    <Button>
                      <Plus className="h-4 w-4" /> Nuevo movimiento
                    </Button>
                  }
                />
                <Button asChild variant="secondary">
                  <Link href={financeHref(params, { period: 'last_12m', from: null, to: null })}>
                    Ver los últimos 12 meses
                  </Link>
                </Button>
              </>
            }
          />
        </Card>
      )}

      <div className={cn('space-y-4 sm:space-y-6', isEmpty && 'opacity-60')}>
        <PulseHero
          periodLabel={period.label}
          previousLabel={period.previousLabel}
          basisLabel={FINANCE_BASIS_LABELS[basis]}
          current={current}
          previous={previous}
          points={series.points}
          forecast={forecast}
          goalCents={goalCents}
          goalForPeriodCents={goalForPeriod}
        />

        {!isEmpty && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-[1.55fr_1fr]">
              <Reveal>
                <InsightsCard
                  insights={insights}
                  categories={categories}
                  professionals={professionals}
                  counterparties={counterparties}
                  todayKey={todayKey}
                />
              </Reveal>
              <Reveal delay={80}>
                <DiagnosisCard report={health} />
              </Reveal>
            </div>

            <Reveal>
              <Card>
                <CardTopbar
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone="grape"
                  title="Ingresos y gastos"
                  subtitle={`Por ${series.granularity === 'day' ? 'día' : series.granularity === 'week' ? 'semana' : 'mes'} · toca una columna para ver el detalle`}
                />
                <div className="px-3 pb-5 sm:px-5 sm:pb-6">
                  <FlowChart points={series.points} showNet={series.granularity !== 'day'} />
                </div>
              </Card>
            </Reveal>

            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
              <Card>
                <CardTopbar
                  icon={<Stethoscope className="h-4 w-4" />}
                  tone="mint"
                  title="De dónde vienen los ingresos"
                  subtitle="Qué tratamientos sostienen la clínica"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <RankList
                    items={incomeItems}
                    total={current.incomeCents}
                    emptyLabel="Sin ingresos en el período"
                  />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<PieChart className="h-4 w-4" />}
                  tone="honey"
                  title="A dónde va el dinero"
                  subtitle="Gastos por categoría"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <Donut
                    centerLabel="en gastos"
                    emptyLabel="Sin gastos apuntados en el período"
                    parts={current.expenseByCategory.map((r) => ({
                      id: r.id,
                      name: r.isFixed ? `${r.name} · fijo` : r.name,
                      cents: r.cents,
                      color: finColor(categoryIndex.get(r.id) ?? 7),
                    }))}
                  />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="sky"
                  title="Cómo te pagan"
                  subtitle="Cobros por método"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <Donut
                    centerLabel="cobrado"
                    emptyLabel="Sin cobros con método registrado"
                    parts={current.incomeByMethod.map((r) => ({
                      id: r.id,
                      name: r.name,
                      cents: r.cents,
                      color: METHOD_COLOR[r.id] ?? '#c9d1ce',
                    }))}
                  />
                </div>
              </Card>
              {showProfessionals ? (
                <Card>
                  <CardTopbar
                    icon={<Users className="h-4 w-4" />}
                    tone="blossom"
                    title="Ingresos por profesional"
                    subtitle="Quién factura cuánto"
                  />
                  <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                    <RankList
                      items={current.incomeByProfessional.map((r) => ({
                        id: r.id,
                        name: r.name,
                        cents: r.cents,
                        hint: plural(r.sessions, 'sesión', 'sesiones'),
                        color: finColor(professionalIndex.get(r.id) ?? 0),
                      }))}
                      total={current.incomeCents}
                      emptyLabel="Sin ingresos atribuidos a un profesional"
                    />
                  </div>
                </Card>
              ) : (
                <CostStructureCard current={current} be={be} />
              )}
            </div>

            {/* Con un solo profesional, lo pendiente ocupa toda la fila. */}
            <div
              className={cn(
                'grid grid-cols-1 gap-4 sm:gap-6',
                showProfessionals && 'xl:grid-cols-2',
              )}
            >
              <AgingCard
                aging={aging}
                receivables={open.receivables}
                totalCents={open.receivableCents}
                href={pendingIncome}
              />
              {showProfessionals && <CostStructureCard current={current} be={be} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}
