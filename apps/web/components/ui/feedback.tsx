import { cn } from '@/lib/cn';
import type * as React from 'react';

/* ============================================================================
   Estados vacíos, cargas y avisos — mismo lenguaje visual en toda la app.
   ========================================================================== */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f4f0ff,#fdf0f7)] text-violet-500 animate-float">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold tracking-tight text-zinc-800">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-zinc-500">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** Bloque de carga para listas: 5 filas con avatar + 2 líneas. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[--color-border-subtle]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Aviso en línea con tono semántico. */
export function Callout({
  tone = 'info',
  icon,
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warn' | 'danger' | 'brand';
  icon?: React.ReactNode;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'bg-sky-50/80 text-sky-900 border-sky-100',
    success: 'bg-emerald-50/80 text-emerald-900 border-emerald-100',
    warn: 'bg-amber-50/80 text-amber-900 border-amber-100',
    danger: 'bg-rose-50/80 text-rose-900 border-rose-100',
    brand: 'bg-violet-50/80 text-violet-900 border-violet-100',
  } as const;
  return (
    <div
      className={cn(
        'flex gap-3 rounded-[18px] border p-4 text-[13px] leading-relaxed',
        tones[tone],
        className,
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 opacity-80">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="mb-0.5 font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Encabezado de sección dentro de una página (separa bloques largos como
 * configuración o ajustes) con línea de acento.
 */
export function SectionTitle({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-zinc-400">
          <span className="h-3 w-1 rounded-full bg-[linear-gradient(180deg,#7139e8,#ec4899)]" />
          {title}
        </h2>
        {description && <p className="mt-1.5 text-[13px] text-zinc-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
