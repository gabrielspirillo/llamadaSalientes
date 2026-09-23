import { BreakdownList, FixedVariableBar } from '@/components/finanzas/breakdown-list';
import {
  CumulativeNetChart,
  IncomeExpenseChart,
  ShareDonut,
} from '@/components/finanzas/charts-lazy';
import { EntryDialog } from '@/components/finanzas/entry-dialog';
import { FinanceFilters } from '@/components/finanzas/finance-filters';
import { GoalInline } from '@/components/finanzas/goal-inline';
import { BreakEvenCard, HealthCard } from '@/components/finanzas/health-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { ProgressBar, StatTile } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import {
  FINANCE_BASIS_LABELS,
  type LedgerLine,
  agingBuckets,
  breakEven,
  buildSeries,
  deltaPct,
  formatCents,
  formatDateKey,
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
  FinanceProfessional,
  FinanceSettingsRecord,
} from '@/lib/finance/queries';
import {
  ArrowDownRight,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  Hourglass,
  Minus,
  PieChart,
  Plus,
  Receipt,
  Stethoscope,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';

/**
 * La pestaña Resumen: la salud del negocio en una pantalla. Todo sale del
 * mismo libro ya cargado; aquí sólo se reparte por período y base y se
 * dibuja. Jerarquía: arriba y grande el Resultado; debajo Ingresos y Gastos;
 * el resto, KPI compactos que llevan a Movimientos con su filtro puesto.
 *
 * Los filtros de esta pestaña son período, base y profesional: la categoría
 * se filtra en Movimientos (un filtro de categoría dejaría sin ingresos al
 * resumen, porque las sesiones no llevan categoría).
 */
export function ResumenTab({
  params,
  ledger,
  categories,
  professionals,
  counterparties,
  settings,
  todayKey,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  counterparties: CounterpartySuggestion[];
  settings: FinanceSettingsRecord;
  todayKey: string;
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

  const months = monthsInRange(period);
  const goalCents = settings.monthlyRevenueGoalCents;
  // Meses enteros que abarca el período (este mes = 1, el trimestre en curso = 3).
  const goalForPeriod = goalCents ? goalCents * Math.max(1, Math.round(months)) : null;
  const goalPct =
    goalForPeriod && goalForPeriod > 0
      ? Math.min(100, Math.round((current.incomeCents / goalForPeriod) * 100))
      : null;

  // Color estable por entidad: el índice de la categoría en el catálogo de la
  // clínica, no su puesto en el ranking del período.
  const categoryIndex = new Map(categories.map((c, i) => [c.id, i]));
  const methodIndex: Record<string, number> = {
    CARD: 0,
    CASH: 1,
    BIZUM: 2,
    TRANSFER: 3,
    DIRECT_DEBIT: 4,
  };
  const professionalIndex = new Map(professionals.map((p, i) => [p.id, i]));

  const isEmpty =
    current.incomeCents === 0 &&
    current.expenseCents === 0 &&
    open.receivables.length === 0 &&
    open.payables.length === 0;
  const hasPrevious = previous.incomeCents > 0 || previous.expenseCents > 0;
  const vs = `vs. ${period.previousLabel}`;
  const marginDelta =
    current.marginPct !== null && previous.marginPct !== null
      ? Math.round(current.marginPct - previous.marginPct)
      : null;

  const activeCategories = categories.filter((c) => c.active);
  const activeProfessionals = professionals.filter((p) => p.active);
  const movimientos = (override: Record<string, string | null>) =>
    financeHref(params, { tab: 'movimientos', ...override });

  const netDelta = deltaPct(current.netCents, previous.netCents);
  const netTone =
    current.netCents > 0
      ? 'text-emerald-700'
      : current.netCents < 0
        ? 'text-rose-700'
        : 'text-zinc-900';

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
        {/* Resultado: la cifra que responde "¿va bien?" */}
        <Reveal>
          <Card className="overflow-hidden">
            <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="min-w-0">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                  Resultado · {period.label}
                </p>
                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                  <span
                    className={cn(
                      'text-[40px] font-extrabold leading-none tracking-tight sm:text-[48px]',
                      netTone,
                    )}
                  >
                    {formatCents(current.netCents)}
                  </span>
                  <Delta
                    value={netDelta}
                    label={vs}
                    fallback={hasPrevious ? null : `Sin datos de ${period.previousLabel}`}
                  />
                </div>
                <p className="mt-3 text-[14px] text-zinc-700">
                  Margen neto{' '}
                  <strong className="text-zinc-900">
                    {current.marginPct === null
                      ? 'sin datos'
                      : `${current.marginPct.toString().replace('.', ',')} %`}
                  </strong>
                  {marginDelta !== null && (
                    <span className="text-zinc-600">
                      {' '}
                      ({marginDelta > 0 ? '+' : ''}
                      {marginDelta} puntos {vs})
                    </span>
                  )}
                  {' · '}base {FINANCE_BASIS_LABELS[basis].toLowerCase()}
                </p>
              </div>
              <div className="flex flex-col justify-center gap-2 rounded-[18px] bg-[#fafbfb] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-800">
                    <Target className="h-4 w-4 text-sky-600" /> Objetivo de ingresos
                  </span>
                  <GoalInline monthlyRevenueGoalCents={goalCents} />
                </div>
                {goalForPeriod && goalPct !== null ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-zinc-700">
                        {formatCents(current.incomeCents)} de {formatCents(goalForPeriod)}
                      </span>
                      <span className="font-bold tabular-nums text-zinc-900">{goalPct} %</span>
                    </div>
                    <ProgressBar
                      value={goalPct}
                      tone={goalPct >= 100 ? 'mint' : goalPct >= 60 ? 'sky' : 'honey'}
                    />
                    <p className="text-[12px] text-zinc-600">
                      {goalPct >= 100
                        ? 'Objetivo cumplido en este período.'
                        : `Faltan ${formatCents(goalForPeriod - current.incomeCents)} para llegar.`}
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-zinc-600">
                    Sin objetivo. Fija uno y aquí verás cuánto falta cada mes.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </Reveal>

        {/* Ingresos y gastos: verde lo que entra, ámbar lo que sale. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <Reveal delay={0}>
            <Link
              href={movimientos({ kind: 'INCOME', status: null })}
              className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
            >
              <StatTile
                label="Ingresos"
                value={formatCents(current.incomeCents)}
                valueClassName="text-emerald-700"
                delta={hasPrevious ? deltaPct(current.incomeCents, previous.incomeCents) : null}
                hint={
                  hasPrevious
                    ? `${vs}: ${formatCents(previous.incomeCents)}`
                    : `Sin datos de ${period.previousLabel}`
                }
                icon={<ArrowDownToLine className="h-4 w-4" />}
                tone="mint"
                trend={series.points.map((p) => p.incomeCents / 100)}
              />
            </Link>
          </Reveal>
          <Reveal delay={70}>
            <Link
              href={movimientos({ kind: 'EXPENSE', status: null })}
              className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
            >
              <StatTile
                label="Gastos"
                value={formatCents(current.expenseCents)}
                valueClassName="text-amber-700"
                delta={hasPrevious ? deltaPct(current.expenseCents, previous.expenseCents) : null}
                hint={
                  hasPrevious
                    ? `${vs}: ${formatCents(previous.expenseCents)} · fijos ${formatCents(current.fixedCents)}`
                    : `Fijos ${formatCents(current.fixedCents)}`
                }
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                tone="honey"
                trend={series.points.map((p) => p.expenseCents / 100)}
              />
            </Link>
          </Reveal>
        </div>

        {/* KPI secundarios, compactos. Los pendientes llevan a Movimientos ya filtrado. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <MiniKpi
            label="Ticket medio"
            value={
              current.avgTicketCents === null
                ? 'Aún sin sesiones'
                : formatCents(current.avgTicketCents)
            }
            hint={
              current.avgTicketCents === null
                ? 'Ingreso medio por sesión'
                : plural(current.sessions, 'sesión cobrada', 'sesiones cobradas')
            }
            icon={<Stethoscope className="h-4 w-4" />}
            tone="brand"
          />
          <MiniKpi
            label={basis === 'cash' ? 'Sesiones cobradas' : 'Sesiones facturadas'}
            value={String(current.sessions)}
            hint={`${formatCents(current.sessionsIncomeCents)} en sesiones · ${formatCents(current.otherIncomeCents)} otros`}
            icon={<CalendarClock className="h-4 w-4" />}
            tone="brand"
          />
          <MiniKpi
            label="Pendiente de cobro"
            value={formatCents(open.receivableCents)}
            valueClassName={open.receivableCents > 0 ? 'text-amber-700' : undefined}
            hint={`${plural(open.receivables.length, 'sesión', 'sesiones')} · ${open.unbilledSessions} sin cobro registrado`}
            icon={<Hourglass className="h-4 w-4" />}
            tone="amber"
            href={movimientos({
              kind: 'INCOME',
              status: 'PENDING',
              period: 'last_12m',
              from: null,
              to: null,
            })}
          />
          <MiniKpi
            label="Pendiente de pago"
            value={formatCents(open.payableCents)}
            valueClassName={open.payableCents > 0 ? 'text-rose-700' : undefined}
            hint={plural(open.payables.length, 'gasto sin pagar', 'gastos sin pagar')}
            icon={<Receipt className="h-4 w-4" />}
            tone="rose"
            href={movimientos({
              kind: 'EXPENSE',
              status: 'PENDING',
              period: 'last_12m',
              from: null,
              to: null,
            })}
          />
        </div>

        {!isEmpty && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <HealthCard report={health} />
              </div>
              <BreakEvenCard be={be} />
            </div>

            <Reveal>
              <Card>
                <CardTopbar
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone="grape"
                  title="Ingresos frente a gastos"
                  subtitle={`Por ${series.granularity === 'day' ? 'día' : series.granularity === 'week' ? 'semana' : 'mes'} · resultado como línea`}
                  action={<Badge tone="accent">{period.label}</Badge>}
                />
                <div className="px-2 pb-5 sm:px-4 sm:pb-6">
                  <IncomeExpenseChart points={series.points} />
                </div>
              </Card>
            </Reveal>

            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardTopbar
                  icon={<Wallet className="h-4 w-4" />}
                  tone="mint"
                  title="Resultado acumulado"
                  subtitle="Lo que va ganando (o perdiendo) la clínica a lo largo del período"
                />
                <div className="px-2 pb-5 sm:px-4 sm:pb-6">
                  <CumulativeNetChart points={series.points} />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<PieChart className="h-4 w-4" />}
                  tone="honey"
                  title="Gastos por categoría"
                  subtitle="Dónde se va el dinero"
                />
                <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                  <ShareDonut
                    centerLabel="gastos"
                    slices={current.expenseByCategory.map((r) => ({
                      name: r.name,
                      cents: r.cents,
                      colorIndex: categoryIndex.get(r.id) ?? 99,
                    }))}
                  />
                  <div className="mt-4 border-t border-(--color-border-subtle) pt-4">
                    <BreakdownList
                      total={current.expenseCents}
                      items={current.expenseByCategory.map((r) => ({
                        id: r.id,
                        name: r.name,
                        cents: r.cents,
                        hint: r.isFixed ? 'fijo' : null,
                        colorIndex: categoryIndex.get(r.id) ?? 99,
                      }))}
                      emptyLabel="Sin gastos en el período"
                    />
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
              <Card>
                <CardTopbar
                  icon={<Stethoscope className="h-4 w-4" />}
                  tone="blossom"
                  title="Ingresos por tratamiento"
                  subtitle="Qué servicios sostienen la clínica"
                />
                <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                  <BreakdownList
                    total={current.incomeCents}
                    items={[
                      ...current.incomeByTreatment.map((r, i) => ({
                        id: r.id,
                        name: r.name,
                        cents: r.cents,
                        hint: plural(r.sessions, 'sesión', 'sesiones'),
                        colorIndex: i,
                      })),
                      ...current.incomeByCategory
                        .filter((r) => r.id !== 'sessions')
                        .map((r) => ({
                          id: `cat:${r.id}`,
                          name: r.name,
                          cents: r.cents,
                          hint: plural(r.count, 'movimiento', 'movimientos'),
                          colorIndex: 7,
                        })),
                    ]}
                    emptyLabel="Sin ingresos en el período"
                  />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<Users className="h-4 w-4" />}
                  tone="sky"
                  title="Ingresos por profesional"
                  subtitle="Quién factura cuánto"
                />
                <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                  <BreakdownList
                    total={current.incomeCents}
                    items={current.incomeByProfessional.map((r) => ({
                      id: r.id,
                      name: r.name,
                      cents: r.cents,
                      hint: plural(r.sessions, 'sesión', 'sesiones'),
                      colorIndex: professionalIndex.get(r.id) ?? 99,
                    }))}
                    emptyLabel="Sin ingresos atribuidos a un profesional"
                  />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="grape"
                  title="Cobros por método"
                  subtitle="Tarjeta, efectivo, Bizum…"
                />
                <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                  <ShareDonut
                    centerLabel="cobrado"
                    slices={current.incomeByMethod.map((r) => ({
                      name: r.name,
                      cents: r.cents,
                      colorIndex: methodIndex[r.id] ?? 5,
                    }))}
                  />
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
              <Card>
                <CardTopbar
                  icon={<Receipt className="h-4 w-4" />}
                  tone="honey"
                  title="Fijos y variables"
                  subtitle="Lo que se paga pase lo que pase, y lo que depende de la actividad"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <FixedVariableBar
                    fixedCents={current.fixedCents}
                    variableCents={current.variableCents}
                  />
                </div>
              </Card>
              <Card>
                <CardTopbar
                  icon={<Hourglass className="h-4 w-4" />}
                  tone="coral"
                  title="Pendiente de cobro"
                  subtitle="Cuánto lleva sin cobrarse"
                  action={
                    open.receivables.length > 0 ? (
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={movimientos({
                            kind: 'INCOME',
                            status: 'PENDING',
                            period: 'last_12m',
                            from: null,
                            to: null,
                          })}
                        >
                          Ver todas <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    ) : undefined
                  }
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  {open.receivables.length === 0 ? (
                    <p className="py-4 text-center text-[13px] text-zinc-600">
                      Nada pendiente de cobro
                    </p>
                  ) : (
                    <>
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {aging.map((b, i) => (
                          <li
                            key={b.label}
                            className={cn(
                              'rounded-xl p-2.5 text-[12px]',
                              i >= 2 && b.count > 0 ? 'bg-rose-50' : 'bg-[#fafbfb]',
                            )}
                          >
                            <p className="text-zinc-600">{b.label}</p>
                            <p className="font-bold tabular-nums text-zinc-900">
                              {formatCents(b.cents)}
                            </p>
                            <p className="text-zinc-600">{plural(b.count, 'sesión', 'sesiones')}</p>
                          </li>
                        ))}
                      </ul>
                      <ul className="mt-4 divide-y divide-(--color-border-subtle)">
                        {open.receivables.slice(0, 6).map((l) => (
                          <li key={l.key} className="flex items-center gap-3 py-2 text-[13px]">
                            <span className="w-16 shrink-0 text-zinc-600">
                              {formatDateKey(l.occurredOn, { year: false })}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-zinc-800">
                              {l.patientName ?? l.concept}
                              <span className="text-zinc-500"> · {l.concept}</span>
                            </span>
                            <span className="shrink-0 font-bold tabular-nums text-zinc-900">
                              {l.amountCents === null ? 'Sin importe' : formatCents(l.amountCents)}
                            </span>
                            {l.patientKey && (
                              <Link
                                href={`/dashboard/agenda/pacientes/${encodeURIComponent(l.patientKey)}?tab=contable`}
                                className="shrink-0 text-[12px] font-semibold text-brand-700 hover:underline"
                              >
                                Cobrar
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Delta({
  value,
  label,
  fallback,
}: { value: number | null; label: string; fallback: string | null }) {
  if (value === null) {
    return fallback ? <span className="text-[13px] text-zinc-600">{fallback}</span> : null;
  }
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-bold',
        dir === 'up' && 'bg-emerald-50 text-emerald-700',
        dir === 'down' && 'bg-rose-50 text-rose-700',
        dir === 'flat' && 'bg-zinc-100 text-zinc-600',
      )}
    >
      {dir === 'up' && <ArrowUpRight className="h-3.5 w-3.5" />}
      {dir === 'down' && <ArrowDownRight className="h-3.5 w-3.5" />}
      {dir === 'flat' && <Minus className="h-3.5 w-3.5" />}
      {value > 0 ? `+${value}` : value} % {label}
    </span>
  );
}

const MINI_TONE = {
  brand: 'bg-brand-100 text-brand-700',
  amber: 'bg-amber-100 text-amber-700',
  rose: 'bg-rose-100 text-rose-700',
} as const;

/** KPI compacto. Con `href`, toda la tarjeta lleva a Movimientos con el filtro puesto. */
function MiniKpi({
  label,
  value,
  valueClassName,
  hint,
  icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  hint: string;
  icon: React.ReactNode;
  tone: keyof typeof MINI_TONE;
  href?: string;
}) {
  const body = (
    <div
      className={cn(
        'flex h-full items-start gap-3 rounded-[18px] border border-(--color-border) bg-white p-3.5 shadow-[var(--shadow-soft)] transition-all duration-300',
        href && 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-lifted)]',
      )}
    >
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          MINI_TONE[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-zinc-600">{label}</p>
        <p
          className={cn(
            'mt-0.5 truncate text-[20px] font-bold leading-tight tracking-tight text-zinc-900',
            valueClassName,
          )}
        >
          {value}
        </p>
        <p className="mt-0.5 text-[12px] text-zinc-600">{hint}</p>
        {href && (
          <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700">
            Ver movimientos <ArrowRight className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-[18px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
