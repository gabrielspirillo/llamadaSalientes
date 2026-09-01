import { cn } from '@/lib/cn';
import type * as React from 'react';

/* ============================================================================
   Tabla del sistema: cabecera discreta, filas con hover suave y scroll propio.
   Todas las tablas del panel comparten este lenguaje.
   ========================================================================== */

export function TableWrap({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('w-full overflow-x-auto', className)}>{children}</div>;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-[640px] text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('', className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-[--color-border-subtle] transition-colors duration-200 last:border-b-0 hover:bg-brand-50/40',
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-5 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-5 py-3.5 align-middle text-zinc-700', className)} {...props} />;
}

/** Fila de cabecera lista para usar: `<THead><HeadRow>…</HeadRow></THead>`. */
export function HeadRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-[--color-border] bg-[#fafdfb]', className)} {...props} />
  );
}
