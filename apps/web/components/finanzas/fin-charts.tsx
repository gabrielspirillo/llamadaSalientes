'use client';

import { cn } from '@/lib/cn';
import { type SeriesPoint, formatCents, formatEuros } from '@/lib/finance/model';
import { useState } from 'react';

/**
 * Gráficos del Resumen de Finanzas, hechos a mano (sin recharts): barras y
 * líneas en HTML + SVG, que se dibujan UNA vez al entrar con transform o con
 * el trazo (`.ring-fill`). Pesan nada y se ven igual en móvil.
 */

export const INCOME = { from: '#6cc3a5', to: '#2f7a66', solid: '#3d8f78' };
export const EXPENSE = { from: '#f2c98a', to: '#d4964a', solid: '#d79a4e' };

/** "1,2 k €" para los ejes: corto y legible. */
export function shortEuros(cents: number): string {
  const e = cents / 100;
  const abs = Math.abs(e);
  if (abs >= 1000) return `${(e / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} k €`;
  return `${Math.round(e).toLocaleString('es-ES')} €`;
}

/** Los meses de antes de empezar a usar Finanzas no aportan nada: fuera. */
function trimLeadingEmpty(points: SeriesPoint[]): SeriesPoint[] {
  const first = points.findIndex((p) => p.incomeCents !== 0 || p.expenseCents !== 0);
  if (first <= 0) return points;
  return points.slice(Math.min(first, Math.max(0, points.length - 2)));
}

function niceCeil(v: number): number {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/**
 * Ingresos y gastos por día, semana o mes, con el resultado como línea. Al
 * pasar (o tocar) una columna sale su detalle.
 */
export function FlowChart({
  points: all,
  showNet = true,
}: {
  points: SeriesPoint[];
  /** Por días, el resultado de cada día es ruido (el alquiler cae un día): se omite. */
  showNet?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const points = trimLeadingEmpty(all);
  const empty = points.every((p) => p.incomeCents === 0 && p.expenseCents === 0);
  if (empty) {
    return (
      <div className="flex h-56 items-center justify-center text-[13px] text-zinc-500">
        Sin movimientos en el período
      </div>
    );
  }
  const max = Math.max(1, ...points.map((p) => Math.max(p.incomeCents, p.expenseCents)));
  const minNet = Math.min(0, ...points.map((p) => p.netCents));
  // Escala redonda: 0 · 100 · 200 · 300 €, no 0 · 167 · 333 €.
  const step = niceCeil(max / 4);
  const top = Math.ceil(max / step) * step;
  // Un resultado apenas negativo no merece medio eje: se queda en el cero.
  const bottom = showNet && minNet < 0 && -minNet > top * 0.08 ? -niceCeil(-minNet) : 0;
  const span = top - bottom || 1;
  const y = (v: number) => Math.min(100, Math.max(0, ((top - v) / span) * 100));
  const n = points.length;
  const ticks =
    bottom < 0
      ? [top, top / 2, 0, bottom]
      : Array.from({ length: Math.round(top / step) + 1 }, (_, i) => top - i * step);
  const labelEvery = n > 16 ? Math.ceil(n / 8) : 1;
  const linePts = points.map((p, i) => [((i + 0.5) / n) * 100, y(p.netCents)] as const);
  const path = linePts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
  const cur = active !== null ? points[active] : null;

  return (
    <div className="select-none">
      <div className="flex gap-2">
        {/* Eje: tres o cuatro marcas, nada más */}
        <div className="relative h-60 w-12 shrink-0 text-right text-[11px] tabular-nums text-zinc-400 sm:h-64">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {shortEuros(t)}
            </span>
          ))}
        </div>
        <div className="relative h-60 min-w-0 flex-1 sm:h-64" onMouseLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <span
              key={t}
              aria-hidden
              className={cn(
                'absolute inset-x-0 h-px',
                t === 0 ? 'bg-zinc-300/80' : 'bg-zinc-200/60',
              )}
              style={{ top: `${y(t)}%` }}
            />
          ))}

          {/* Columnas */}
          <div className="absolute inset-0 flex">
            {points.map((p, i) => (
              <button
                key={p.key}
                type="button"
                aria-label={`${p.label}: ingresos ${formatCents(p.incomeCents)}, gastos ${formatCents(p.expenseCents)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onClick={() => setActive((a) => (a === i ? null : i))}
                className={cn(
                  'relative h-full flex-1 rounded-lg transition-colors duration-200',
                  active === i ? 'bg-brand-500/[0.06]' : '',
                )}
              >
                <span
                  className="absolute inset-x-[14%] flex justify-center gap-[3px]"
                  style={{ top: 0, bottom: `${100 - y(0)}%` }}
                >
                  <Bar cents={p.incomeCents} top={top} color={INCOME} delay={i * 30} />
                  <Bar cents={p.expenseCents} top={top} color={EXPENSE} delay={i * 30 + 60} />
                </span>
              </button>
            ))}
          </div>

          {/* Resultado */}
          {showNet && (
            <svg
              aria-hidden
              role="presentation"
              className="reveal-x pointer-events-none absolute inset-0 h-full w-full overflow-visible"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <path
                d={path}
                fill="none"
                stroke="#1d3a33"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {showNet &&
            linePts.map(([px, py], i) => (
              <span
                key={points[i]?.key}
                aria-hidden
                className={cn(
                  'pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#1d3a33] bg-white transition-transform duration-200',
                  active === i ? 'scale-150' : n > 16 ? 'scale-0' : '',
                )}
                style={{ left: `${px}%`, top: `${py}%` }}
              />
            ))}

          {/* Detalle */}
          {cur && active !== null && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-48 rounded-2xl border border-white/80 bg-white/95 p-3 text-[12px] shadow-[0_18px_40px_-18px_rgba(20,33,29,0.45)] animate-fade-in"
              style={
                (active + 0.5) / n > 0.6
                  ? { right: `${100 - ((active + 0.5) / n) * 100 + 3}%` }
                  : { left: `${((active + 0.5) / n) * 100 + 3}%` }
              }
            >
              <p className="font-semibold capitalize text-zinc-900">{cur.label}</p>
              <Row color={INCOME.solid} label="Ingresos" cents={cur.incomeCents} />
              <Row color={EXPENSE.solid} label="Gastos" cents={cur.expenseCents} />
              <div className="mt-1.5 border-t border-zinc-100 pt-1.5">
                <Row color="#1d3a33" label="Resultado" cents={cur.netCents} strong />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Etiquetas */}
      <div className="ml-14 mt-2 flex text-[11px] text-zinc-500">
        {points.map((p, i) => (
          <span key={p.key} className="flex-1 truncate text-center capitalize">
            {i % labelEvery === 0 ? p.label : ''}
          </span>
        ))}
      </div>
      <div className="ml-14 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-zinc-600">
        <Legend color={INCOME.solid} label="Ingresos" />
        <Legend color={EXPENSE.solid} label="Gastos" />
        {showNet && <Legend color="#1d3a33" label="Resultado" line />}
      </div>
    </div>
  );
}

function Bar({
  cents,
  top,
  color,
  delay,
}: {
  cents: number;
  top: number;
  color: { from: string; to: string };
  delay: number;
}) {
  // El contenedor va del cero al tope del eje: el alto es cents / tope.
  const h = top > 0 ? Math.max(0, (cents / top) * 100) : 0;
  return (
    <span className="relative flex h-full w-full max-w-[22px] items-end">
      {cents > 0 && (
        <span
          className="block w-full origin-bottom animate-grow-y rounded-t-[6px] rounded-b-[2px]"
          style={{
            height: `${Math.min(100, h)}%`,
            background: `linear-gradient(180deg, ${color.from}, ${color.to})`,
            animationDelay: `${Math.min(delay, 500)}ms`,
          }}
        />
      )}
    </span>
  );
}

function Row({
  color,
  label,
  cents,
  strong,
}: { color: string; label: string; cents: number; strong?: boolean }) {
  return (
    <p className="mt-1 flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-zinc-600">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className={cn('tabular-nums', strong ? 'font-bold text-zinc-900' : 'text-zinc-800')}>
        {formatCents(cents)}
      </span>
    </p>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={line ? 'h-0.5 w-4 rounded-full' : 'h-2.5 w-2.5 rounded-[4px]'}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

/**
 * Lo acumulado en el período, para el bloque oscuro de arriba: el área menta
 * es lo que entra y la línea ámbar lo que sale; el hueco entre las dos es lo
 * que gana la clínica.
 */
export function CumulativeSpark({ points: all }: { points: SeriesPoint[] }) {
  const points = trimLeadingEmpty(all);
  let inc = 0;
  let exp = 0;
  const acc = points.map((p) => {
    inc += p.incomeCents;
    exp += p.expenseCents;
    return { inc, exp };
  });
  const max = Math.max(1, inc, exp);
  const n = Math.max(1, acc.length - 1);
  const W = 300;
  const H = 110;
  const pt = (i: number, v: number) => [(i / n) * W, H - 6 - (v / max) * (H - 16)] as const;
  const incPts = acc.map((a, i) => pt(i, a.inc));
  const expPts = acc.map((a, i) => pt(i, a.exp));
  const line = (ps: (readonly [number, number])[]) =>
    ps.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  const area = `${line(incPts)} L${W},${H} L0,${H} Z`;
  const lastInc = incPts[incPts.length - 1] ?? [W, H];
  const lastExp = expPts[expPts.length - 1] ?? [W, H];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="reveal-x h-28 w-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden
      role="presentation"
    >
      <defs>
        <linearGradient id="finSparkInc" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#finSparkInc)" />
      <path
        d={line(incPts)}
        fill="none"
        stroke="#a7f3d0"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {exp > 0 && (
        <path
          d={line(expPts)}
          fill="none"
          stroke="#f2c98a"
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle cx={lastInc[0]} cy={lastInc[1]} r={4} fill="#a7f3d0" className="animate-pop" />
      {exp > 0 && (
        <circle cx={lastExp[0]} cy={lastExp[1]} r={3.5} fill="#f2c98a" className="animate-pop" />
      )}
    </svg>
  );
}

export interface DonutPart {
  id: string;
  name: string;
  cents: number;
  color: string;
}

/** Reparto en anillo fino, con el total en el centro y la leyenda al lado. */
export function Donut({
  parts,
  centerLabel,
  emptyLabel,
}: { parts: DonutPart[]; centerLabel: string; emptyLabel: string }) {
  const positive = parts.filter((p) => p.cents > 0).sort((a, b) => b.cents - a.cents);
  const head = positive.slice(0, 6);
  const rest = positive.slice(6).reduce((a, p) => a + p.cents, 0);
  const shown =
    rest > 0 ? [...head, { id: 'otros', name: 'Otros', cents: rest, color: '#c9d1ce' }] : head;
  const total = shown.reduce((a, p) => a + p.cents, 0);
  if (total === 0) {
    return <p className="py-10 text-center text-[13px] text-zinc-500">{emptyLabel}</p>;
  }
  const gap = shown.length > 1 ? 1.2 : 0;
  let start = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0">
        <svg
          viewBox="0 0 100 100"
          className="h-full w-full -rotate-90"
          aria-hidden
          role="presentation"
        >
          <circle cx="50" cy="50" r="40" fill="none" stroke="#eef2f0" strokeWidth="9" />
          {shown.map((p, i) => {
            const len = (p.cents / total) * 100;
            const seg = (
              <circle
                key={p.id}
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke={p.color}
                strokeWidth="9"
                strokeLinecap="butt"
                pathLength={100}
                strokeDasharray={`${Math.max(0, len - gap)} ${100 - Math.max(0, len - gap)}`}
                strokeDashoffset={-start}
                className="donut-seg"
                style={{ animationDelay: `${150 + i * 90}ms` }}
              />
            );
            start += len;
            return seg;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[17px] font-bold tabular-nums tracking-tight text-zinc-900">
            {total < 10_000_000 ? formatEuros(total) : shortEuros(total)}
          </span>
          <span className="text-[11px] text-zinc-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {shown.map((p, i) => (
          <li
            key={p.id}
            className="flex items-center gap-2 text-[13px] animate-fade-up"
            style={{ animationDelay: `${200 + i * 60}ms` }}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate text-zinc-700">{p.name}</span>
            <span className="shrink-0 tabular-nums text-zinc-500">
              {Math.round((p.cents / total) * 100)} %
            </span>
            <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-zinc-900">
              {formatCents(p.cents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
