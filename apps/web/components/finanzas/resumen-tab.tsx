import { BreakdownList, FixedVariableBar } from '@/components/finanzas/breakdown-list';
import {
  CumulativeNetChart,
  IncomeExpenseChart,
  ShareDonut,
} from '@/components/finanzas/charts-lazy';
import { FinanceFilters } from '@/components/finanzas/finance-filters';
import { BreakEvenCard, HealthCard } from '@/components/finanzas/health-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
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
  summarizeLedger,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import type {
  FinanceCategoryRecord,
  FinanceProfessional,
  FinanceSettingsRecord,
} from '@/lib/finance/queries';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  CreditCard,
  Hourglass,
  PieChart,
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
 * dibuja. Los filtros de esta pestaña son período, base y profesional: la
 * categoría se filtra en Movimientos (un filtro de categoría dejaría sin
 * ingresos al resumen, porque las sesiones no llevan categoría).
 */
export function ResumenTab({
  params,
  ledger,
  categories,
  professionals,
  settings,
  todayKey,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
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
  const marginDelta =
    current.marginPct !== null && previous.marginPct !== null
      ? Math.round(current.marginPct - previous.marginPct)
      : null;

  return (
    <>
      <FinanceFilters
        params={params}
        categories={categories.filter((c) => c.active)}
        professionals={professionals.filter((p) => p.active)}
        show={{ basis: true, professional: true }}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Ingresos"
            value={formatCents(current.incomeCents)}
            delta={deltaPct(current.incomeCents, previous.incomeCents)}
            hint={`Antes: ${formatCents(previous.incomeCents)} · ${FINANCE_BASIS_LABELS[basis].toLowerCase()}`}
            icon={<ArrowDownToLine className="h-4 w-4" />}
            tone="mint"
            trend={
              series.points.length > 1 ? series.points.map((p) => p.incomeCents / 100) : undefined
            }
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="Gastos"
            value={formatCents(current.expenseCents)}
            delta={deltaPct(current.expenseCents, previous.expenseCents)}
            hint={`Antes: ${formatCents(previous.expenseCents)} · fijos ${formatCents(current.fixedCents)}`}
            icon={<ArrowUpFromLine className="h-4 w-4" />}
            tone="honey"
            trend={
              series.points.length > 1 ? series.points.map((p) => p.expenseCents / 100) : undefined
            }
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Resultado"
            value={formatCents(current.netCents)}
            delta={deltaPct(current.netCents, previous.netCents)}
            hint={`Antes: ${formatCents(previous.netCents)}`}
            icon={<Wallet className="h-4 w-4" />}
            tone={current.netCents >= 0 ? 'grape' : 'coral'}
            trend={
              series.points.length > 1
                ? series.points.map((p) => p.cumulativeNetCents / 100)
                : undefined
            }
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Margen neto"
            value={
              current.marginPct === null
                ? '—'
                : `${current.marginPct.toString().replace('.', ',')} %`
            }
            delta={marginDelta}
            hint={
              marginDelta === null
                ? 'De cada 100 € ingresados, lo que queda'
                : 'Puntos respecto al anterior'
            }
            icon={<TrendingUp className="h-4 w-4" />}
            tone="sky"
            progress={
              current.marginPct === null ? undefined : Math.max(0, Math.min(100, current.marginPct))
            }
          />
        </Reveal>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Ticket medio"
            value={current.avgTicketCents === null ? '—' : formatCents(current.avgTicketCents)}
            delta={
              current.avgTicketCents !== null && previous.avgTicketCents !== null
                ? deltaPct(current.avgTicketCents, previous.avgTicketCents)
                : null
            }
            hint="Ingreso medio por sesión"
            icon={<Stethoscope className="h-4 w-4" />}
            tone="grape"
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label={basis === 'cash' ? 'Sesiones cobradas' : 'Sesiones facturadas'}
            numeric={current.sessions}
            delta={deltaPct(current.sessions, previous.sessions)}
            hint={`${formatCents(current.sessionsIncomeCents)} en sesiones · ${formatCents(current.otherIncomeCents)} otros`}
            icon={<CalendarClock className="h-4 w-4" />}
            tone="blossom"
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Pendiente de cobro"
            value={formatCents(open.receivableCents)}
            hint={`${open.receivables.length} sesión${open.receivables.length === 1 ? '' : 'es'} · ${open.unbilledSessions} sin cobro registrado`}
            icon={<Hourglass className="h-4 w-4" />}
            tone={open.receivableCents > 0 ? 'honey' : 'mint'}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Pendiente de pago"
            value={formatCents(open.payableCents)}
            hint={`${open.payables.length} gasto${open.payables.length === 1 ? '' : 's'} sin pagar`}
            icon={<Receipt className="h-4 w-4" />}
            tone={open.payableCents > 0 ? 'coral' : 'mint'}
          />
        </Reveal>
      </div>

      {isEmpty ? (
        <Callout
          tone="brand"
          icon={<PieChart className="h-4 w-4" />}
          title="Sin movimientos en este período"
        >
          Registra los gastos de la clínica con «Nuevo movimiento» y cobra las sesiones desde la
          ficha de cada paciente: con eso el resumen se llena solo. Si ya tienes datos, prueba con
          otro período.
        </Callout>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <HealthCard report={health} />
            </div>
            <div className="flex flex-col gap-4 sm:gap-6">
              <BreakEvenCard be={be} />
              <Card>
                <CardTopbar
                  icon={<Target className="h-4 w-4" />}
                  tone="sky"
                  title="Objetivo de ingresos"
                  subtitle={goalCents ? `${formatCents(goalCents)} al mes` : 'Sin objetivo fijado'}
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  {goalForPeriod && goalPct !== null ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="text-zinc-600">
                          {formatCents(current.incomeCents)} de {formatCents(goalForPeriod)}
                        </span>
                        <span className="font-bold tabular-nums text-zinc-900">{goalPct} %</span>
                      </div>
                      <div className="mt-2">
                        <ProgressBar
                          value={goalPct}
                          tone={goalPct >= 100 ? 'mint' : goalPct >= 60 ? 'sky' : 'honey'}
                        />
                      </div>
                      <p className="mt-2 text-[12px] text-zinc-500">
                        {goalPct >= 100
                          ? 'Objetivo cumplido en este período.'
                          : `Faltan ${formatCents(goalForPeriod - current.incomeCents)} para llegar.`}
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-zinc-600">
                      Fija un objetivo mensual en{' '}
                      <Link
                        href="/dashboard/finanzas?tab=ajustes"
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        Ajustes
                      </Link>{' '}
                      y aquí verás cuánto falta cada mes.
                    </p>
                  )}
                </div>
              </Card>
            </div>
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
                      hint: `${r.sessions} sesión${r.sessions === 1 ? '' : 'es'}`,
                      colorIndex: i,
                    })),
                    ...current.incomeByCategory
                      .filter((r) => r.id !== 'sessions')
                      .map((r) => ({
                        id: `cat:${r.id}`,
                        name: r.name,
                        cents: r.cents,
                        hint: `${r.count} movimiento${r.count === 1 ? '' : 's'}`,
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
                    hint: `${r.sessions} sesión${r.sessions === 1 ? '' : 'es'}`,
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
                      <Link href="/dashboard/finanzas?tab=movimientos&kind=INCOME&status=PENDING&period=last_12m">
                        Ver todas
                      </Link>
                    </Button>
                  ) : undefined
                }
              />
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                {open.receivables.length === 0 ? (
                  <p className="py-4 text-center text-[13px] text-zinc-400">
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
                          <p className="text-zinc-500">{b.label}</p>
                          <p className="font-bold tabular-nums text-zinc-900">
                            {formatCents(b.cents)}
                          </p>
                          <p className="text-zinc-500">
                            {b.count} sesión{b.count === 1 ? '' : 'es'}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <ul className="mt-4 divide-y divide-(--color-border-subtle)">
                      {open.receivables.slice(0, 6).map((l) => (
                        <li key={l.key} className="flex items-center gap-3 py-2 text-[13px]">
                          <span className="w-16 shrink-0 text-zinc-500">
                            {formatDateKey(l.occurredOn, { year: false })}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-800">
                            {l.patientName ?? l.concept}
                            <span className="text-zinc-400"> · {l.concept}</span>
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
        </div>
      )}
    </>
  );
}
