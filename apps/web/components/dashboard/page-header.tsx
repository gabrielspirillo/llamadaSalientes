import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * Encabezado común de todas las páginas del panel.
 * Añade: eyebrow opcional, título con degradado, icono en pastilla y acciones.
 */
export function PageHeader({
  title,
  description,
  actions,
  demoBadge,
  eyebrow,
  icon,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Mostrar pill "Datos de muestra" — para páginas que aún usan mockData. */
  demoBadge?: boolean;
  /** Texto pequeño encima del título (sección / contexto). */
  eyebrow?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mb-6 flex animate-fade-down flex-col gap-4 sm:mb-8 md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        {icon && (
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 sm:inline-flex">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-[32px]">
              {title}
            </h1>
            {demoBadge && (
              <Badge tone="warn" size="lg">
                Datos de muestra
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-zinc-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
