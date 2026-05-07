import { Badge } from '@/components/ui/badge';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
  demoBadge,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Mostrar pill "Datos de muestra" — para páginas que aún usan mockData. */
  demoBadge?: boolean;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {demoBadge && <Badge tone="warn">Datos de muestra</Badge>}
        </div>
        {description && <p className="mt-1.5 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
