'use client';

import { AnimatedNumber } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import * as React from 'react';

/* ============================================================================
   Bloques de datos reutilizables: KPI, sparkline, barras, anillos, avatares.
   ========================================================================== */

export type StatTone = 'grape' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral';

const TONE: Record<StatTone, { chip: string; bar: string; glow: string; stroke: string }> = {
  grape: {
    chip: 'bg-brand-100 text-brand-600',
    bar: 'bg-[linear-gradient(90deg,#37766a,#5fa896)]',
    glow: 'from-brand-200/60',
    stroke: '#5fa896',
  },
  blossom: {
    chip: 'bg-emerald-100 text-emerald-600',
    bar: 'bg-[linear-gradient(90deg,#2f8f7a,#6bc2a4)]',
    glow: 'from-emerald-200/60',
    stroke: '#2f8f7a',
  },
  mint: {
    chip: 'bg-emerald-100 text-emerald-600',
    bar: 'bg-[linear-gradient(90deg,#059669,#34d399)]',
    glow: 'from-emerald-200/60',
    stroke: '#10b981',
  },
  sky: {
    chip: 'bg-teal-100 text-teal-700',
    bar: 'bg-[linear-gradient(90deg,#2b6f6f,#5fb0b0)]',
    glow: 'from-teal-200/60',
    stroke: '#3d8b8b',
  },
  honey: {
    chip: 'bg-amber-100 text-amber-600',
    bar: 'bg-[linear-gradient(90deg,#d97706,#fbbf24)]',
    glow: 'from-amber-200/60',
    stroke: '#f59e0b',
  },
  coral: {
    chip: 'bg-rose-100 text-rose-600',
    bar: 'bg-[linear-gradient(90deg,#e11d48,#fb7185)]',
    glow: 'from-rose-200/60',
    stroke: '#f43f5e',
  },
};

/**
 * Tarjeta KPI: número animado, delta con dirección, sparkline opcional y
 * halo de color que aparece al hacer hover.
 */
export function StatTile({
  label,
  value,
  numeric,
  decimals = 0,
  suffix = '',
  delta,
  hint,
  icon,
  tone = 'grape',
  trend,
  progress,
  className,
}: {
  label: string;
  /** Valor ya formateado (p. ej. "3m 12s"). Se ignora si se pasa `numeric`. */
  value?: string;
  /** Valor numérico → se anima contando. */
  numeric?: number;
  decimals?: number;
  suffix?: string;
  /** Variación respecto al período anterior. */
  delta?: number | null;
  hint?: string;
  icon?: React.ReactNode;
  tone?: StatTone;
  /** Serie para el sparkline (opcional). */
  trend?: number[];
  /** 0–100: dibuja barra de progreso al pie. */
  progress?: number;
  className?: string;
}) {
  const t = TONE[tone];
  const dir = delta == null ? 'flat' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-[22px] border border-[--color-border] bg-white p-5',
        'shadow-[var(--shadow-soft)] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'hover:-translate-y-1 hover:shadow-[var(--shadow-lifted)]',
        className,
      )}
    >
      {/* Halo de color al hover */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br to-transparent opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100',
          t.glow,
        )}
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[16px] font-medium text-zinc-500">{label}</p>
        {icon && (
          <span
            className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110',
              t.chip,
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="relative mt-3 flex items-baseline gap-2">
        <span className="text-[34px] font-bold leading-none tracking-tight text-zinc-900 sm:text-[38px]">
          {numeric != null ? (
            <AnimatedNumber value={numeric} decimals={decimals} suffix={suffix} />
          ) : (
            value
          )}
        </span>
        {delta != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[13px] font-bold',
              dir === 'up' && 'bg-emerald-50 text-emerald-600',
              dir === 'down' && 'bg-rose-50 text-rose-600',
              dir === 'flat' && 'bg-zinc-100 text-zinc-500',
            )}
          >
            {dir === 'up' && <ArrowUpRight className="h-3 w-3" />}
            {dir === 'down' && <ArrowDownRight className="h-3 w-3" />}
            {dir === 'flat' && <Minus className="h-3 w-3" />}
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>

      {hint && <p className="relative mt-1.5 text-[13px] text-zinc-400">{hint}</p>}

      {trend && trend.length > 1 && (
        <div className="relative mt-3 -mb-1">
          <Sparkline data={trend} stroke={t.stroke} height={34} />
        </div>
      )}

      {progress != null && (
        <div className="relative mt-4">
          <ProgressBar value={progress} tone={tone} />
        </div>
      )}
    </div>
  );
}

/** Mini gráfico de línea con área y animación de trazo. */
export function Sparkline({
  data,
  stroke = '#5fa896',
  height = 36,
  className,
}: {
  data: number[];
  stroke?: string;
  height?: number;
  className?: string;
}) {
  const w = 100;
  const h = height;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 3 - ((v - min) / span) * (h - 8);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = React.useId();

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-9 w-full overflow-visible', className)}
      aria-hidden
      role="presentation"
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${id})`} className="animate-fade-in" />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ strokeDasharray: 400, ['--dash' as string]: 400 }}
        className="animate-draw"
      />
      <circle
        cx={pts.at(-1)?.[0]}
        cy={pts.at(-1)?.[1]}
        r="2.5"
        fill={stroke}
        className="animate-pop"
      />
    </svg>
  );
}

/** Barra de progreso con relleno animado y gradiente. */
export function ProgressBar({
  value,
  tone = 'grape',
  showLabel = false,
  className,
  delay = 120,
}: {
  value: number;
  tone?: StatTone;
  showLabel?: boolean;
  className?: string;
  delay?: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="mb-1.5 flex items-center justify-between text-[13px]">
          <span className="font-medium text-zinc-500">Progreso</span>
          <span className="font-bold tabular-nums text-zinc-700">{pct}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className={cn('bar-fill h-full rounded-full', TONE[tone].bar)}
          style={{ width: `${pct}%`, ['--bar-delay' as string]: `${delay}ms` }}
        />
      </div>
    </div>
  );
}

/**
 * Progreso por puntos (como en el tablero de referencia): 10 puntos que se
 * llenan según el porcentaje, con entrada escalonada.
 */
export function ProgressDots({
  value,
  total = 10,
  tone = 'grape',
  className,
}: {
  value: number;
  total?: number;
  tone?: StatTone;
  className?: string;
}) {
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * total);
  const dotColor: Record<StatTone, string> = {
    grape: 'bg-brand-500',
    blossom: 'bg-emerald-500',
    mint: 'bg-emerald-500',
    sky: 'bg-sky-500',
    honey: 'bg-amber-500',
    coral: 'bg-rose-500',
  };
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {Array.from({ length: total }, (_, i) => ({ id: `dot-${i}`, i })).map(({ id, i }) => (
        <span
          key={id}
          className={cn(
            'h-2 w-2 rounded-full transition-colors',
            i < filled ? dotColor[tone] : 'bg-zinc-200',
            i < filled && 'animate-pop',
          )}
          style={{ animationDelay: `${i * 45}ms` }}
        />
      ))}
    </div>
  );
}

/** Anillo de progreso con trazo animado. */
export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  tone = 'grape',
  label,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: StatTone;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden role="presentation">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e8f4ee"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TONE[tone].stroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ ['--dash' as string]: c * (1 - pct / 100) }}
          strokeDashoffset={c * (1 - pct / 100)}
          className="animate-draw"
        />
      </svg>
      <span className="absolute text-[14px] font-bold tabular-nums text-zinc-800">
        {label ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

/** Pila de avatares con iniciales y colores estables (como la referencia). */
const AVATAR_BG = [
  'bg-brand-200 text-brand-800',
  'bg-emerald-200 text-emerald-800',
  'bg-teal-200 text-teal-800',
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-teal-100 text-teal-700',
];

export function Avatar({
  name,
  src,
  size = 28,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatares remotos de GHL/WhatsApp, sin dominios fijos
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ring-white',
        AVATAR_BG[h % AVATAR_BG.length],
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || '?'}
    </span>
  );
}

export function AvatarStack({
  names,
  max = 4,
  size = 28,
  className,
}: {
  names: string[];
  max?: number;
  size?: number;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className={cn('flex items-center', className)}>
      {shown
        .map((n, i) => ({ key: `avatar-${i}-${n}`, n, i }))
        .map(({ key, n, i }) => (
          <span
            key={key}
            className="-ml-2 transition-transform duration-300 first:ml-0 hover:z-10 hover:-translate-y-1"
            style={{ zIndex: shown.length - i }}
          >
            <Avatar name={n} size={size} />
          </span>
        ))}
      {rest > 0 && (
        <span
          className="-ml-2 inline-flex items-center justify-center rounded-full bg-zinc-100 font-bold text-zinc-500 ring-2 ring-white"
          style={{ width: size, height: size, fontSize: size * 0.34 }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

/** Indicador "en vivo" con barras que oscilan. */
export function Equalizer({ className }: { className?: string }) {
  return (
    <span className={cn('equalizer inline-flex h-3 items-end gap-[2px]', className)}>
      <span className="h-2" />
      <span className="h-3" />
      <span className="h-2.5" />
      <span className="h-1.5" />
    </span>
  );
}
