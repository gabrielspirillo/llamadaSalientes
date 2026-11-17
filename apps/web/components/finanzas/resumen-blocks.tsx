import { EntryDialog } from '@/components/finanzas/entry-dialog';
import { CumulativeSpark } from '@/components/finanzas/fin-charts';
import { GoalInline } from '@/components/finanzas/goal-inline';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import type { Insight, MonthForecast } from '@/lib/finance/insights';
import {
  type AgingBucket,
  type BreakEven,
  type FinanceSummary,
  HEALTH_OVERALL_LABELS,
  type HealthReport,
  type LedgerLine,
  type SeriesPoint,
  type SignalLevel,
  displayName,
  formatCents,
  formatDateKey,
  formatEuros,
  plural,
} from '@/lib/finance/model';
import type {
  CounterpartySuggestion,
  FinanceCategoryRecord,
  FinanceProfessional,
} from '@/lib/finance/queries';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Lightbulb,
  Minus,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';

/** Colores de las entidades (categorías, tratamientos, métodos): en la gama de la marca. */
export const FIN_PALETTE = [
  '#3d8f78',
  '#7cc8ad',
  '#d79a4e',
  '#7aa6c2',
  '#b48fc8',
  '#e08f7b',
  '#9bb87a',
  '#c9b26b',
];
export const finColor = (i: number) => FIN_PALETTE[i % FIN_PALETTE.length] as string;

function euros(cents: number): number {
  return Math.round(cents / 100);
}

// ─── Bloque de arriba ───────────────────────────────────────────────────────

export function PulseHero({
  periodLabel,
  previousLabel,
  basisLabel,
  current,
  previous,
  points,
  forecast,
  goalCents,
  goalForPeriodCents,
}: {
  periodLabel: string;
  previousLabel: string;
  basisLabel: string;
  current: FinanceSummary;
  previous: FinanceSummary;
  points: SeriesPoint[];
  forecast: MonthForecast | null;
  goalCents: number | null;
  goalForPeriodCents: number | null;
}) {
  const net = current.netCents;
  const hasPrev = previous.incomeCents > 0 || previous.expenseCents > 0;
  const delta =
    hasPrev && previous.netCents !== 0
      ? Math.round(((net - previous.netCents) / Math.abs(previous.netCents)) * 100)
      : null;
  const expenseShare =
    current.incomeCents > 0
      ? Math.min(100, Math.round((current.expenseCents / current.incomeCents) * 100))
      : current.expenseCents > 0
        ? 100
        : 0;
  const keep = Math.max(0, 100 - expenseShare);

  return (
    <section
      data-slot="hero"
      className="relative mb-6 overflow-hidden rounded-[26px] bg-[linear-gradient(140deg,#14211d_0%,#1d3a33_55%,#2b5a4d_100%)] p-5 text-white shadow-[var(--shadow-float)] sm:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(110,231,183,0.24),transparent_68%)]"
      />
      <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-8">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200/90">
            Resultado · {periodLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'text-[44px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[56px]',
                net < 0 ? 'text-rose-200' : 'text-white',
              )}
            >
              <AnimatedNumber value={euros(net)} suffix=" €" grouping />
            </span>
            {delta !== null ? (
              <DeltaPill value={delta} label={`vs. ${previousLabel}`} />
            ) : (
              <span className="text-[13px] text-white/60">Sin datos de {previousLabel}</span>
            )}
          </div>
          <p className="mt-2 text-[13px] text-white/60">
            Lo que queda tras pagar los gastos · {basisLabel.toLowerCase()}
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
            <HeroStat
              label="Ingresos"
              dot="#a7f3d0"
              value={euros(current.incomeCents)}
              suffix=" €"
            />
            <HeroStat
              label="Gastos"
              dot="#f2c98a"
              value={euros(current.expenseCents)}
              suffix=" €"
            />
            <HeroStat
              label="Margen"
              dot="#ffffff"
              value={
                current.marginPct === null || current.expenseCents === 0
                  ? null
                  : Math.round(current.marginPct)
              }
              suffix=" %"
            />
          </div>

          {/* De cada 100 € que entran. Sin gastos apuntados saldría «100 € se
              quedan», que no es verdad: se dice lo que falta. */}
          {current.expenseCents === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-white/20 px-4 py-3 text-[12.5px] leading-relaxed text-white/70">
              Sin gastos apuntados en el período, el resultado es todo lo que entra. Apunta
              alquiler, nóminas y suministros para ver cuánto se queda de cada 100 €.
            </p>
          ) : (
            <div className="mt-5">
              <div className="flex items-baseline justify-between text-[12px] text-white/70">
                <span>De cada 100 € que entran</span>
                <span>
                  <strong className="text-white">{keep} €</strong> se quedan
                </span>
              </div>
              <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-white/10">
                {expenseShare > 0 && (
                  <span
                    className="h-full origin-left animate-grow-x bg-[linear-gradient(90deg,#f2c98a,#d4964a)]"
                    style={{ width: `${expenseShare}%` }}
                    title={`${expenseShare} € en gastos`}
                  />
                )}
                {keep > 0 && (
                  <span
                    className="h-full origin-left animate-grow-x bg-[linear-gradient(90deg,#6cc3a5,#a7f3d0)]"
                    style={{ width: `${keep}%`, animationDelay: '250ms' }}
                  />
                )}
              </div>
              <p className="mt-1.5 text-[12px] text-white/55">{expenseShare} € se van en gastos.</p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col rounded-[20px] bg-white/[0.06] p-4 ring-1 ring-white/10 sm:p-5">
          <div className="flex items-center justify-between gap-2 text-[12px] text-white/70">
            <span className="font-semibold text-white/85">Acumulado del período</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#a7f3d0]" /> Entra
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#f2c98a]" /> Sale
              </span>
            </span>
          </div>
          <div className="mt-3">
            <CumulativeSpark points={points} />
          </div>

          <div className="mt-auto border-t border-white/10 pt-4">
            {forecast ? (
              <ForecastBlock forecast={forecast} goalCents={goalCents} />
            ) : (
              <GoalBlock
                incomeCents={current.incomeCents}
                goalForPeriodCents={goalForPeriodCents}
                goalCents={goalCents}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroStat({
  label,
  dot,
  value,
  suffix,
}: { label: string; dot: string; value: number | null; suffix: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/65">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
        {label}
      </p>
      <p className="mt-0.5 truncate text-[17px] font-bold tabular-nums tracking-tight sm:text-[19px]">
        {value === null ? '—' : <AnimatedNumber value={value} suffix={suffix} grouping />}
      </p>
    </div>
  );
}

function DeltaPill({ value, label }: { value: number; label: string }) {
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1',
        flat
          ? 'bg-white/10 text-white/80 ring-white/15'
          : up
            ? 'bg-emerald-300/15 text-emerald-100 ring-emerald-200/25'
            : 'bg-rose-300/15 text-rose-100 ring-rose-200/25',
      )}
    >
      {flat ? (
        <Minus className="h-3.5 w-3.5" />
      ) : up ? (
        <ArrowUpRight className="h-3.5 w-3.5" />
      ) : (
        <ArrowDownRight className="h-3.5 w-3.5" />
      )}
      {up ? '+' : ''}
      {value} % {label}
    </span>
  );
}

/** Previsión de cierre del mes en curso: lo cobrado + lo que valen las citas agendadas. */
function ForecastBlock({
  forecast,
  goalCents,
}: { forecast: MonthForecast; goalCents: number | null }) {
  const scale = Math.max(forecast.projectedCents, goalCents ?? 0, 1);
  const soFar = (forecast.soFarCents / scale) * 100;
  const upcoming = (forecast.upcomingCents / scale) * 100;
  const goalPct = goalCents ? (goalCents / scale) * 100 : null;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-white/65">Previsión de cierre del mes</p>
          <p className="text-[22px] font-bold tabular-nums tracking-tight">
            <AnimatedNumber value={euros(forecast.projectedCents)} suffix=" €" grouping />
          </p>
        </div>
        <GoalInline monthlyRevenueGoalCents={goalCents} tone="dark" />
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-white/10">
        <span
          className="absolute inset-y-0 left-0 origin-left animate-grow-x rounded-l-full bg-[#a7f3d0]"
          style={{ width: `${soFar}%` }}
        />
        <span
          className="absolute inset-y-0 origin-left animate-grow-x rounded-r-full bg-[repeating-linear-gradient(135deg,rgba(167,243,208,0.55)_0_4px,rgba(167,243,208,0.25)_4px_8px)]"
          style={{ left: `${soFar}%`, width: `${upcoming}%`, animationDelay: '300ms' }}
        />
        {goalPct !== null && (
          <span
            className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-white"
            style={{ left: `calc(${Math.min(goalPct, 100)}% - 1px)` }}
            title={`Objetivo: ${formatCents(goalCents ?? 0)}`}
          />
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-white/60">
        {formatCents(forecast.soFarCents)} ya cobrados
        {forecast.upcomingSessions > 0 &&
          ` + ${plural(forecast.upcomingSessions, 'cita agendada', 'citas agendadas')} hasta fin de mes`}
        {forecast.estimatedSessions > 0 && ' (las que no tienen precio, al ticket medio)'}
        {goalCents ? ` · objetivo ${formatCents(goalCents)}` : ''}.
      </p>
    </div>
  );
}

function GoalBlock({
  incomeCents,
  goalForPeriodCents,
  goalCents,
}: { incomeCents: number; goalForPeriodCents: number | null; goalCents: number | null }) {
  const pct =
    goalForPeriodCents && goalForPeriodCents > 0
      ? Math.min(100, Math.round((incomeCents / goalForPeriodCents) * 100))
      : null;
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-white/65">Objetivo de ingresos</p>
          <p className="text-[22px] font-bold tabular-nums tracking-tight">
            {pct === null ? 'Sin objetivo' : `${pct} %`}
          </p>
        </div>
        <GoalInline monthlyRevenueGoalCents={goalCents} tone="dark" />
      </div>
      {pct !== null && goalForPeriodCents ? (
        <>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full origin-left animate-grow-x rounded-full bg-[#a7f3d0]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-white/60">
            {formatCents(incomeCents)} de {formatCents(goalForPeriodCents)}
            {pct < 100
              ? ` · faltan ${formatCents(goalForPeriodCents - incomeCents)}`
              : ' · cumplido'}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-white/60">
          Fija un objetivo mensual y aquí verás cuánto falta.
        </p>
      )}
    </div>
  );
}

// ─── Recomendaciones ────────────────────────────────────────────────────────

const INSIGHT_TONE = {
  urgent: { icon: AlertTriangle, chip: 'bg-rose-50 text-rose-600 ring-rose-100', label: 'Ahora' },
  improve: { icon: Lightbulb, chip: 'bg-amber-50 text-amber-600 ring-amber-100', label: 'Mejora' },
  good: {
    icon: Sparkles,
    chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    label: 'Va bien',
  },
} as const;

export function InsightsCard({
  insights,
  categories,
  professionals,
  counterparties,
  todayKey,
}: {
  insights: Insight[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  counterparties: CounterpartySuggestion[];
  todayKey: string;
}) {
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<Lightbulb className="h-4 w-4" />}
        tone="honey"
        title="Qué haría ahora"
        subtitle="Con tus números, de más a menos importante"
      />
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        {insights.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-emerald-50/70 p-4 text-[14px] text-emerald-800">
            <Check className="h-5 w-5 shrink-0" />
            Nada urgente: las cuentas están al día en este período.
          </div>
        ) : (
          <ol className="space-y-2">
            {insights.map((ins, i) => {
              const t = INSIGHT_TONE[ins.tone];
              const Icon = t.icon;
              return (
                <li
                  key={ins.key}
                  className="group flex gap-3 rounded-[18px] p-3 transition-colors duration-200 hover:bg-zinc-50/80 animate-fade-up"
                  style={{ animationDelay: `${Math.min(i * 70, 300)}ms` }}
                >
                  <span
                    className={cn(
                      'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ring-1',
                      t.chip,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-snug text-zinc-900">
                      {ins.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">{ins.body}</p>
                    {ins.action && (
                      <div className="mt-2">
                        {ins.action.kind === 'link' ? (
                          <Link
                            href={ins.action.href}
                            className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline"
                          >
                            {ins.action.label}
                            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                          </Link>
                        ) : (
                          <EntryDialog
                            mode="create"
                            categories={categories.filter((c) => c.active)}
                            professionals={professionals.filter((p) => p.active)}
                            counterparties={counterparties}
                            todayKey={todayKey}
                            defaultKind="EXPENSE"
                            trigger={
                              <Button size="sm" variant="secondary">
                                {ins.action.label}
                              </Button>
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {/* «Sin gastos» ordena por lo que entra, pero ese importe no
                      está «en juego»: no se enseña. */}
                  {ins.impactCents !== null && ins.impactCents > 0 && ins.key !== 'no_expenses' && (
                    <span className="hidden shrink-0 self-start rounded-full bg-zinc-100 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-zinc-700 sm:inline">
                      {formatEuros(ins.impactCents)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}

// ─── Diagnóstico ────────────────────────────────────────────────────────────

const LEVEL: Record<SignalLevel, { dot: string; label: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'Bien' },
  warn: { dot: 'bg-amber-400', label: 'Vigilar' },
  bad: { dot: 'bg-rose-500', label: 'Mal' },
  na: { dot: 'bg-zinc-300', label: 'Sin dato' },
};

const OVERALL = {
  healthy: { stroke: '#10b981', text: 'text-emerald-700' },
  watch: { stroke: '#f59e0b', text: 'text-amber-700' },
  risk: { stroke: '#f43f5e', text: 'text-rose-700' },
  na: { stroke: '#a1a1aa', text: 'text-zinc-600' },
} as const;

export function DiagnosisCard({ report }: { report: HealthReport }) {
  const tone = OVERALL[report.overall];
  const scored = report.signals.filter((s) => s.level !== 'na').length;
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<Sparkles className="h-4 w-4" />}
        tone="mint"
        title="Diagnóstico"
        subtitle="Las señales que mira un asesor"
      />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0">
            <svg
              viewBox="0 0 100 100"
              className="h-full w-full -rotate-90"
              aria-hidden
              role="presentation"
            >
              <circle cx="50" cy="50" r="42" fill="none" stroke="#eef2f0" strokeWidth="8" />
              {report.score !== null && (
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke={tone.stroke}
                  strokeWidth="8"
                  strokeLinecap="round"
                  pathLength={100}
                  strokeDasharray="100 100"
                  strokeDashoffset={100 - report.score}
                  className="ring-fill"
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[24px] font-bold tabular-nums leading-none text-zinc-900">
                {report.score === null ? '—' : <AnimatedNumber value={report.score} />}
              </span>
              <span className="text-[10px] text-zinc-500">de 100</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className={cn('text-[17px] font-bold tracking-tight', tone.text)}>
              {HEALTH_OVERALL_LABELS[report.overall]}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-600">
              {scored === 0
                ? 'Faltan datos: apunta ingresos y gastos para tener diagnóstico.'
                : report.score === null
                  ? `Sólo ${plural(scored, 'señal tiene', 'señales tienen')} dato: apunta los gastos y pon precio a los tratamientos para tener una nota fiable.`
                  : `Con ${plural(scored, 'señal', 'señales')} de ${report.signals.length}: las demás necesitan más datos.`}
            </p>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-(--color-border-subtle)">
          {report.signals.map((s, i) => (
            <li
              key={s.key}
              title={s.detail}
              className={cn(
                'flex items-center gap-2.5 py-2.5 text-[13px] animate-fade-up',
                s.level === 'na' && 'opacity-55',
              )}
              style={{ animationDelay: `${120 + i * 50}ms` }}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', LEVEL[s.level].dot)} />
              <span className="min-w-0 flex-1 truncate text-zinc-700">{s.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-900">
                {s.level === 'na' ? 'Falta dato' : s.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ─── Listas con barra ───────────────────────────────────────────────────────

export interface RankItem {
  id: string;
  name: string;
  cents: number;
  hint?: string | null;
  color: string;
}

export function RankList({
  items,
  total,
  emptyLabel,
  max = 6,
}: { items: RankItem[]; total: number; emptyLabel: string; max?: number }) {
  const rows = items.filter((r) => r.cents > 0).slice(0, max);
  if (rows.length === 0) {
    return <p className="py-8 text-center text-[13px] text-zinc-500">{emptyLabel}</p>;
  }
  const top = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.id} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">
              <span className="font-medium text-zinc-800">{displayName(r.name)}</span>
              {r.hint && <span className="text-zinc-500"> · {r.hint}</span>}
            </span>
            <span className="shrink-0 tabular-nums">
              {total > 0 && (
                <span className="mr-2 text-[12px] text-zinc-500">
                  {Math.round((r.cents / total) * 100)} %
                </span>
              )}
              <span className="font-semibold text-zinc-900">{formatCents(r.cents)}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <span
              className="block h-full origin-left animate-grow-x rounded-full"
              style={{
                width: `${(r.cents / top) * 100}%`,
                background: r.color,
                animationDelay: `${150 + i * 70}ms`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Pendiente de cobro ─────────────────────────────────────────────────────

const AGING_COLORS = ['#7cc8ad', '#f2c98a', '#e8a35e', '#e07a6e'];

export function AgingCard({
  aging,
  receivables,
  totalCents,
  href,
}: { aging: AgingBucket[]; receivables: LedgerLine[]; totalCents: number; href: string }) {
  const count = aging.reduce((a, b) => a + b.count, 0);
  const centsSum = aging.reduce((a, b) => a + Math.max(b.cents, 0), 0);
  // Sin importes (tratamientos sin precio) la barra se reparte por sesiones.
  const byCount = centsSum === 0;
  const weight = (b: AgingBucket) => (byCount ? b.count : Math.max(b.cents, 0));
  const sum = Math.max(1, byCount ? count : centsSum);
  const unpriced = receivables.filter((l) => l.amountCents === null).length;
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<AlertTriangle className="h-4 w-4" />}
        tone="coral"
        title="Pendiente de cobro"
        subtitle={
          count === 0
            ? 'Todo cobrado'
            : totalCents > 0
              ? `${formatCents(totalCents)} en ${plural(count, 'sesión', 'sesiones')}, por antigüedad`
              : `${plural(count, 'sesión', 'sesiones')} sin cobrar, por antigüedad`
        }
        action={
          count > 0 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={href}>
                Ver todo <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : undefined
        }
      />
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {count === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl bg-emerald-50/70 p-4 text-[14px] text-emerald-800">
            <Check className="h-5 w-5 shrink-0" /> Nada pendiente de cobro.
          </div>
        ) : (
          <>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
              {aging.map((b, i) =>
                b.count > 0 ? (
                  <span
                    key={b.label}
                    className="h-full origin-left animate-grow-x first:rounded-l-full last:rounded-r-full"
                    style={{
                      flex: `${weight(b) / sum || 0.04} 0 0`,
                      minWidth: 6,
                      background: AGING_COLORS[i],
                      animationDelay: `${i * 120}ms`,
                    }}
                  />
                ) : null,
              )}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {aging.map((b, i) => (
                <li key={b.label} className={cn('text-[12px]', b.count === 0 && 'opacity-45')}>
                  <p className="flex items-center gap-1.5 text-zinc-500">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: AGING_COLORS[i] }}
                    />
                    {b.label}
                  </p>
                  <p className="font-semibold tabular-nums text-zinc-900">
                    {b.cents > 0 ? formatCents(b.cents) : plural(b.count, 'sesión', 'sesiones')}
                  </p>
                </li>
              ))}
            </ul>
            {unpriced > 0 && (
              <p className="mt-4 rounded-2xl bg-amber-50/80 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
                {unpriced === count ? 'Ninguna tiene' : `${unpriced} no tienen`} importe: el
                tratamiento no tiene precio. Pónselo y aquí verás cuánto falta por cobrar.
              </p>
            )}
            <ul className="mt-3 divide-y divide-(--color-border-subtle)">
              {receivables.slice(0, 5).map((l) => (
                <li key={l.key} className="flex items-center gap-3 py-2.5 text-[13px]">
                  <span className="w-14 shrink-0 tabular-nums text-zinc-500">
                    {formatDateKey(l.occurredOn, { year: false })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-zinc-800">
                    {l.patientName ?? l.concept}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-zinc-900">
                    {l.amountCents === null ? (
                      <span className="font-normal text-zinc-400">Sin importe</span>
                    ) : (
                      formatCents(l.amountCents)
                    )}
                  </span>
                  {l.patientKey && (
                    <Link
                      href={`/dashboard/agenda/pacientes/${encodeURIComponent(l.patientKey)}?tab=contable`}
                      className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
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
  );
}

// ─── Estructura de costes ───────────────────────────────────────────────────

export function CostStructureCard({ current, be }: { current: FinanceSummary; be: BreakEven }) {
  const total = current.fixedCents + current.variableCents;
  const fixedPct = total > 0 ? Math.round((current.fixedCents / total) * 100) : 0;
  const needed = be.sessionsPerMonth;
  const actual = be.sessionsPerMonthActual;
  const scale = Math.max(needed ?? 0, actual, 1);
  return (
    <Card className="h-full">
      <CardTopbar
        icon={<Sparkles className="h-4 w-4" />}
        tone="sky"
        title="Punto de equilibrio"
        subtitle="Cuántas sesiones al mes pagan los gastos fijos"
      />
      <div className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
        {needed === null ? (
          <p className="rounded-2xl bg-zinc-50 p-4 text-[13px] leading-relaxed text-zinc-600">
            {be.fixedMonthlyCents === 0
              ? 'Apunta los gastos que se pagan pase lo que pase (alquiler, nóminas, seguros) y márcalos como «fijos»: aquí verás cuántas sesiones al mes hacen falta para cubrirlos.'
              : be.avgTicketCents === null
                ? 'Sin sesiones cobradas todavía no se puede calcular.'
                : 'El precio de la sesión no cubre ni su coste variable: no hay número de sesiones que lo arregle.'}
          </p>
        ) : (
          <div className="space-y-3">
            <BarRow
              label="Necesarias"
              value={`${needed} / mes`}
              pct={(needed / scale) * 100}
              color="#c9d1ce"
            />
            <BarRow
              label="Las que haces"
              value={`${actual.toString().replace('.', ',')} / mes`}
              pct={(actual / scale) * 100}
              color={actual >= needed ? '#3d8f78' : '#e07a6e'}
              delay={200}
            />
            <p className="text-[12.5px] text-zinc-600">
              Fijos {formatCents(be.fixedMonthlyCents)}/mes · cada sesión deja{' '}
              {formatCents(be.contributionCents ?? 0)}
            </p>
          </div>
        )}
        {total > 0 && (
          <div>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="font-medium text-zinc-700">Fijos y variables</span>
              <span className="tabular-nums text-zinc-500">
                {total > 0 ? `${fixedPct} % fijos` : 'Sin gastos'}
              </span>
            </div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
              {total > 0 && (
                <>
                  <span
                    className="h-full origin-left animate-grow-x bg-[#7aa6c2]"
                    style={{ width: `${fixedPct}%` }}
                  />
                  <span
                    className="h-full origin-left animate-grow-x bg-[#f2c98a]"
                    style={{ width: `${100 - fixedPct}%`, animationDelay: '200ms' }}
                  />
                </>
              )}
            </div>
            <p className="mt-1.5 flex gap-4 text-[12px] text-zinc-500">
              <span>Fijos {formatCents(current.fixedCents)}</span>
              <span>Variables {formatCents(current.variableCents)}</span>
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
  delay = 0,
}: { label: string; value: string; pct: number; color: string; delay?: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-zinc-600">{label}</span>
        <span className="font-semibold tabular-nums text-zinc-900">{value}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-zinc-100">
        <span
          className="block h-full origin-left animate-grow-x rounded-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: color,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}
