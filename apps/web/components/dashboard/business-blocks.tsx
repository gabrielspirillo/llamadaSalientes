import { Card, CardTopbar } from '@/components/ui/card';
import { AnimatedNumber, Reveal } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import type { BusinessPulse } from '@/lib/data/analytics/business-pulse';
import { changePct, ringProgress } from '@/lib/data/analytics/month-model';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  HeartHandshake,
  Target,
  TrendingUp,
} from 'lucide-react';
import type * as React from 'react';

/*
 * Los tres bloques de abajo del panel en una clínica con agenda propia: cómo
 * va el mes (anillos), cuánto se ha ingresado frente al mes pasado y cuántas
 * familias vuelven. Se dibujan una vez al entrar (`ring-fill`, `grow-*`,
 * `pop`) y nada se queda en bucle.
 */

function Change({ pct, vs }: { pct: number | null; vs: string }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[12px] font-bold',
        up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600',
      )}
      title={`Frente a ${vs} a estas alturas del mes`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? '+' : ''}
      {pct} %
    </span>
  );
}

/* ── 1. Tu mes: anillos ───────────────────────────────────────────────── */

type Ring = { label: string; value: string; goal: string; progress: number; color: string };

function Rings({ rings }: { rings: Ring[] }) {
  const size = 168;
  const stroke = 15;
  const c = size / 2;
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="h-[118px] w-[118px] shrink-0 -rotate-90 sm:h-[168px] sm:w-[168px]"
      aria-hidden
      role="presentation"
    >
      {rings.map((r, i) => {
        const radius = c - stroke / 2 - i * (stroke + 3);
        return (
          <g key={r.label}>
            <circle
              cx={c}
              cy={c}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeOpacity={0.14}
              strokeWidth={stroke}
            />
            {r.progress > 0 && (
              <circle
                cx={c}
                cy={c}
                r={radius}
                fill="none"
                stroke={r.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="100 100"
                strokeDashoffset={100 - r.progress * 100}
                className="ring-fill"
                style={{ ['--ring-delay' as string]: `${200 + i * 180}ms` }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function MonthRings({ pulse, occupancyPct }: { pulse: BusinessPulse; occupancyPct: number }) {
  const { sessions, firstVisits } = pulse.month;
  const rings: Ring[] = [
    {
      label: 'Sesiones',
      value: String(sessions.month),
      goal: `de ${sessions.prevTotal} en ${pulse.prevMonthName}`,
      progress: ringProgress(sessions.month, sessions.prevTotal),
      color: '#10b981',
    },
    {
      label: 'Familias nuevas',
      value: String(firstVisits.month),
      goal: `de ${firstVisits.prevTotal} en ${pulse.prevMonthName}`,
      progress: ringProgress(firstVisits.month, firstVisits.prevTotal),
      color: '#0ea5e9',
    },
    {
      label: 'Agenda llena',
      value: `${occupancyPct} %`,
      goal: 'próximos 7 días',
      progress: ringProgress(occupancyPct, 100),
      color: '#f59e0b',
    },
  ];
  const pct = changePct(sessions.month, sessions.prevSame);
  return (
    <Card className="group h-full">
      <CardTopbar
        icon={<Target className="h-4 w-4" />}
        tone="mint"
        title="Tu mes"
        subtitle={`${pulse.monthName.charAt(0).toUpperCase()}${pulse.monthName.slice(1)} frente a ${pulse.prevMonthName}`}
      />
      <div className="flex items-center gap-4 px-5 pb-5 sm:gap-5">
        <Rings rings={rings} />
        <ul className="w-full min-w-0 space-y-3">
          {rings.map((r, i) => (
            <li
              key={r.label}
              className="animate-fade-up"
              style={{ animationDelay: `${250 + i * 120}ms` }}
            >
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-500">
                <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                {r.label}
              </p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[20px] font-bold leading-none tracking-tight text-zinc-900 tabular-nums sm:text-[22px]">
                  {r.value}
                </span>
                <span className="truncate text-[12px] text-zinc-500">{r.goal}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
      {pct != null && (
        <p className="border-t border-(--color-border-subtle) px-5 py-3 text-[12.5px] text-zinc-600">
          Vas{' '}
          <span className={cn('font-semibold', pct >= 0 ? 'text-emerald-700' : 'text-rose-600')}>
            {pct >= 0 ? `un ${pct} % por encima` : `un ${Math.abs(pct)} % por debajo`}
          </span>{' '}
          de {pulse.prevMonthName} a estas alturas ({sessions.prevSame} sesiones)
        </p>
      )}
    </Card>
  );
}

/* ── 2. Ingresos del mes: línea acumulada ─────────────────────────────── */

function linePath(values: number[], n: number, max: number, w: number, h: number): string {
  if (values.length === 0) return '';
  const step = n > 1 ? w / (n - 1) : w;
  return values
    .map(
      (v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`,
    )
    .join(' ');
}

function RevenueBlock({ pulse }: { pulse: BusinessPulse }) {
  const r = pulse.month.revenue;
  const n = Math.max(r.cumPrev.length, pulse.daysThisMonth);
  const max = Math.max(r.prevTotalCents, r.monthCents, 1) * 1.08;
  const W = 320;
  const H = 120;
  const thisLine = linePath(r.cumThis, n, max, W, H);
  const prevLine = linePath(r.cumPrev, n, max, W, H);
  const lastX = r.cumThis.length > 0 ? ((r.cumThis.length - 1) * W) / Math.max(1, n - 1) : 0;
  const lastY = H - ((r.cumThis[r.cumThis.length - 1] ?? 0) / max) * H;
  const area = thisLine ? `${thisLine} L${lastX.toFixed(1)},${H} L0,${H} Z` : '';
  const pct = changePct(r.monthCents, r.prevSameCents);
  const euros = (cents: number) =>
    `${Math.round(cents / 100).toLocaleString('es-ES', { useGrouping: 'always' as unknown as boolean })} €`;
  return (
    <Card className="group h-full">
      <CardTopbar
        icon={<TrendingUp className="h-4 w-4" />}
        tone="mint"
        title="Ingresos del mes"
        subtitle="Sesiones atendidas, a su precio"
      />
      <div className="px-5 pb-5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[34px] font-bold leading-none tracking-tight text-emerald-700">
            <AnimatedNumber value={Math.round(r.monthCents / 100)} suffix=" €" grouping />
          </span>
          <Change pct={pct} vs={pulse.prevMonthName} />
        </div>
        <p className="mt-1.5 text-[12px] text-zinc-500">
          {pulse.prevMonthName.charAt(0).toUpperCase()}
          {pulse.prevMonthName.slice(1)} a estas alturas: {euros(r.prevSameCents)} · mes entero:{' '}
          {euros(r.prevTotalCents)}
        </p>
        <svg
          viewBox={`0 0 ${W} ${H + 8}`}
          preserveAspectRatio="none"
          className="mt-4 h-[120px] w-full overflow-visible"
          aria-hidden
          role="presentation"
        >
          <defs>
            <linearGradient id="rev-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
          </defs>
          {prevLine && (
            <path
              d={prevLine}
              fill="none"
              stroke="#a1a1aa"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              className="animate-fade-in"
            />
          )}
          {area && (
            <path
              d={area}
              fill="url(#rev-area)"
              className="animate-fade-in"
              style={{ animationDelay: '700ms', animationDuration: '900ms' }}
            />
          )}
          {thisLine && (
            <path
              d={thisLine}
              fill="none"
              stroke="#059669"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength={100}
              strokeDasharray="100 100"
              strokeDashoffset={0}
              className="ring-fill"
              style={{ ['--ring-delay' as string]: '150ms' }}
            />
          )}
        </svg>
        {thisLine && (
          <div className="relative -mt-[128px] h-[128px] w-full" aria-hidden>
            <span
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-pop rounded-full bg-emerald-600 ring-4 ring-emerald-200/70"
              style={{
                left: `${(lastX / W) * 100}%`,
                top: `${(lastY / (H + 8)) * 100}%`,
                animationDelay: '1500ms',
              }}
            />
          </div>
        )}
        <div className="mt-3 flex items-center gap-4 text-[11.5px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-emerald-600" />
            {pulse.monthName}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-4 border-t border-dashed border-zinc-400" />
            {pulse.prevMonthName}
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ── 3. Familias atendidas ────────────────────────────────────────────── */

function FamiliesBlock({ pulse }: { pulse: BusinessPulse }) {
  const { month, prevSame, newMonth } = pulse.families;
  const returning = Math.max(0, month - newMonth);
  const pct = changePct(month, prevSame);
  const newShare = month > 0 ? (newMonth / month) * 100 : 0;
  return (
    <Card className="group h-full">
      <CardTopbar
        icon={<HeartHandshake className="h-4 w-4" />}
        tone="sky"
        title="Familias atendidas"
        subtitle={`Distintas, en ${pulse.monthName}`}
      />
      <div className="px-5 pb-5">
        {month === 0 ? (
          <p className="py-10 text-center text-[13px] text-zinc-500">
            Cuando atiendas a las primeras familias del mes, aparecerán aquí.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[34px] font-bold leading-none tracking-tight text-zinc-900">
                <AnimatedNumber value={month} />
              </span>
              <span className="text-[14px] font-medium text-zinc-500">familias</span>
              <Change pct={pct} vs={pulse.prevMonthName} />
            </div>
            <p className="mt-1.5 text-[12px] text-zinc-500">
              {pulse.prevMonthName.charAt(0).toUpperCase()}
              {pulse.prevMonthName.slice(1)} a estas alturas: {prevSame}
            </p>
            <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
              {newMonth > 0 && (
                <span
                  className="h-full origin-left animate-grow-x bg-[linear-gradient(90deg,#38bdf8,#0ea5e9)]"
                  style={{ width: `${newShare}%`, animationDelay: '250ms' }}
                />
              )}
              {returning > 0 && (
                <span
                  className="h-full origin-left animate-grow-x bg-[linear-gradient(90deg,#34d399,#10b981)]"
                  style={{ width: `${100 - newShare}%`, animationDelay: '450ms' }}
                />
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div
                className="animate-fade-up rounded-[16px] bg-sky-50/80 p-3"
                style={{ animationDelay: '500ms' }}
              >
                <p className="text-[24px] font-bold leading-none tracking-tight text-sky-700 tabular-nums">
                  {newMonth}
                </p>
                <p className="mt-1 text-[12px] font-medium text-sky-800/80">
                  {newMonth === 1 ? 'familia nueva' : 'familias nuevas'}
                </p>
              </div>
              <div
                className="animate-fade-up rounded-[16px] bg-emerald-50/80 p-3"
                style={{ animationDelay: '620ms' }}
              >
                <p className="text-[24px] font-bold leading-none tracking-tight text-emerald-700 tabular-nums">
                  {returning}
                </p>
                <p className="mt-1 text-[12px] font-medium text-emerald-800/80">ya venían</p>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

const STAGGER = ['[--i:0]', '[--i:1]', '[--i:2]'];

export function BusinessBlocks({
  pulse,
  occupancyPct,
}: {
  pulse: BusinessPulse;
  occupancyPct: number;
}) {
  const blocks: React.ReactNode[] = [
    <MonthRings key="rings" pulse={pulse} occupancyPct={occupancyPct} />,
    <RevenueBlock key="revenue" pulse={pulse} />,
    <FamiliesBlock key="families" pulse={pulse} />,
  ];
  return (
    <div className="rise-stagger grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
      {blocks.map((b, i) => (
        <Reveal key={STAGGER[i]} className={cn('h-full', STAGGER[i])}>
          {b}
        </Reveal>
      ))}
    </div>
  );
}
