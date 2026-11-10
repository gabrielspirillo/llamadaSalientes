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
        'mb-5 flex animate-fade-down flex-col gap-3 sm:mb-8 sm:gap-4 md:flex-row md:items-center md:justify-between',
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
            <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              {eyebrow}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-[34px]">
              {title}
            </h1>
            {demoBadge && (
              <Badge tone="warn" size="lg">
                Datos de muestra
              </Badge>
            )}
          </div>
          {description && (
            <p className="mt-1 line-clamp-2 max-w-2xl text-[13px] leading-relaxed text-zinc-500 sm:mt-1.5 sm:line-clamp-none sm:text-[14px]">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        // En móvil, una sola fila que se desliza en vez de botones apilados.
        <div className="scrollbar-none -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0 [&>*]:shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
