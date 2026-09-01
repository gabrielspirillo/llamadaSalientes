import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import type * as React from 'react';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold transition-colors duration-200',
  {
    variants: {
      tone: {
        neutral: 'bg-zinc-100 text-zinc-600',
        success: 'bg-emerald-100/80 text-emerald-700',
        warn: 'bg-amber-100/80 text-amber-700',
        danger: 'bg-rose-100/80 text-rose-700',
        info: 'bg-sky-100/80 text-sky-700',
        accent: 'bg-brand-100/80 text-brand-700',
        pink: 'bg-emerald-100/80 text-emerald-700',
        /* Gradiente de marca — para contadores destacados */
        brand:
          'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_4px_12px_-4px_rgba(55,118,106,0.6)]',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-0.5 text-[12px]',
        lg: 'px-3 py-1 text-xs',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/**
 * Etiqueta tipo "#tag" del tablero de referencia: pastel, minúscula, con hash.
 * Se usa para categorizar llamadas, campañas, tratamientos, etc.
 */
const TAG_TONES = [
  'bg-brand-100/70 text-brand-700',
  'bg-emerald-100/70 text-emerald-700',
  'bg-teal-100/70 text-teal-700',
  'bg-brand-200/60 text-brand-800',
  'bg-emerald-200/60 text-emerald-800',
  'bg-teal-200/60 text-teal-800',
] as const;

/** Color estable derivado del texto — la misma etiqueta siempre sale igual. */
function toneFor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TAG_TONES[h % TAG_TONES.length] as string;
}

export function Tag({
  children,
  className,
  hash = true,
}: {
  children: string;
  className?: string;
  hash?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold lowercase tracking-tight',
        toneFor(children),
        className,
      )}
    >
      {hash && <span className="opacity-60">#</span>}
      {children}
    </span>
  );
}

/** Punto de estado con halo animado — "en vivo", "activo", "error". */
export function StatusDot({
  tone = 'success',
  pulse = true,
  className,
}: {
  tone?: 'success' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';
  pulse?: boolean;
  className?: string;
}) {
  const map = {
    success: 'bg-emerald-500',
    warn: 'bg-amber-500',
    danger: 'bg-rose-500',
    info: 'bg-sky-500',
    neutral: 'bg-zinc-400',
    accent: 'bg-brand-500',
  } as const;
  return (
    <span className={cn('relative inline-flex h-2 w-2 shrink-0', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            map[tone],
          )}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', map[tone])} />
    </span>
  );
}
