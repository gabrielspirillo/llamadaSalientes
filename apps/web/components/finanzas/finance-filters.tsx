'use client';

import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  FINANCE_BASES,
  FINANCE_BASIS_LABELS,
  FINANCE_KIND_LABELS,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PERIODS,
  FINANCE_PERIOD_LABELS,
  type FinanceKind,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import { Loader2, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

export interface FilterCategoryOption {
  id: string;
  kind: FinanceKind;
  name: string;
}

export interface FilterProfessionalOption {
  id: string;
  fullName: string;
}

export interface FinanceFiltersProps {
  params: FinanceParams;
  categories: FilterCategoryOption[];
  professionals: FilterProfessionalOption[];
  /** Qué controles enseñar además del período. */
  show: {
    basis?: boolean;
    kind?: boolean;
    status?: boolean;
    category?: boolean;
    professional?: boolean;
    method?: boolean;
    source?: boolean;
    q?: boolean;
  };
}

/**
 * Barra de filtros por URL. Cada cambio es una navegación (el contenido es de
 * servidor), así que se marca `pending` mientras llega. Se conserva la
 * pestaña y el resto de filtros: cambiar el período no borra la categoría.
 */
export function FinanceFilters({ params, categories, professionals, show }: FinanceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(params.filters.q ?? '');
  const [customFrom, setCustomFrom] = React.useState(params.period.from);
  const [customTo, setCustomTo] = React.useState(params.period.to);

  React.useEffect(() => setQ(params.filters.q ?? ''), [params.filters.q]);

  const push = React.useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) sp.set(k, v);
        else sp.delete(k);
      }
      startTransition(() => router.push(`${pathname}?${sp.toString()}`));
    },
    [pathname, router, searchParams],
  );

  const period = params.period.period;
  const hasFilters =
    params.filters.kind ||
    params.filters.status ||
    params.filters.categoryId ||
    params.filters.professionalId ||
    params.filters.method ||
    params.filters.source ||
    params.filters.q;

  const kindForCategories = params.filters.kind;
  const categoryOptions = kindForCategories
    ? categories.filter((c) => c.kind === kindForCategories)
    : categories;

  return (
    <div
      className="mb-5 flex flex-col gap-3 rounded-[22px] border border-(--color-border) bg-white/80 p-3 shadow-[var(--shadow-soft)] backdrop-blur-xl sm:p-4"
      aria-busy={pending || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="scrollbar-none -mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1">
          {FINANCE_PERIODS.map((p) => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  push(
                    p === 'custom'
                      ? { period: p, from: customFrom, to: customTo }
                      : { period: p, from: null, to: null },
                  )
                }
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-all duration-300',
                  active
                    ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_6px_18px_-8px_rgba(55,118,106,0.8)]'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-brand-700',
                )}
              >
                {FINANCE_PERIOD_LABELS[p]}
              </button>
            );
          })}
        </div>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />}
        <span className="ml-auto hidden text-[12px] font-medium text-zinc-500 sm:inline">
          {params.period.label}
        </span>
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap items-end gap-2">
          <label
            htmlFor="fin-from"
            className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-600"
          >
            Desde
            <Input
              id="fin-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-10 w-[160px]"
            />
          </label>
          <label
            htmlFor="fin-to"
            className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-600"
          >
            Hasta
            <Input
              id="fin-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-10 w-[160px]"
            />
          </label>
          <button
            type="button"
            onClick={() => push({ period: 'custom', from: customFrom, to: customTo })}
            className="h-10 rounded-full bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700"
          >
            Aplicar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {show.basis && (
          <fieldset
            className="inline-flex min-w-0 items-center rounded-full border border-(--color-border) bg-white p-0.5"
            aria-label="Base de cálculo"
          >
            {FINANCE_BASES.map((b) => {
              const active = params.basis === b;
              return (
                <button
                  key={b}
                  type="button"
                  aria-pressed={active}
                  title={
                    b === 'cash'
                      ? 'Caja: cuenta lo pagado, por fecha de pago'
                      : 'Devengo: cuenta por fecha del gasto o de la sesión, pagado o no'
                  }
                  onClick={() => push({ basis: b })}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    active ? 'bg-brand-100 text-brand-800' : 'text-zinc-500 hover:text-zinc-800',
                  )}
                >
                  {FINANCE_BASIS_LABELS[b]}
                </button>
              );
            })}
          </fieldset>
        )}
        {show.kind && (
          <Select
            aria-label="Tipo"
            value={params.filters.kind ?? ''}
            onChange={(e) => push({ kind: e.target.value || null, cat: null })}
            className="h-10 w-auto min-w-[130px] text-[13px]"
          >
            <option value="">Ingresos y gastos</option>
            <option value="INCOME">{FINANCE_KIND_LABELS.INCOME}s</option>
            <option value="EXPENSE">{FINANCE_KIND_LABELS.EXPENSE}s</option>
          </Select>
        )}
        {show.status && (
          <Select
            aria-label="Estado"
            value={params.filters.status ?? ''}
            onChange={(e) => push({ status: e.target.value || null })}
            className="h-10 w-auto min-w-[120px] text-[13px]"
          >
            <option value="">Todos los estados</option>
            <option value="PAID">Pagados</option>
            <option value="PENDING">Pendientes</option>
          </Select>
        )}
        {show.category && (
          <Select
            aria-label="Categoría"
            value={params.filters.categoryId ?? ''}
            onChange={(e) => push({ cat: e.target.value || null })}
            className="h-10 w-auto min-w-[150px] text-[13px]"
          >
            <option value="">Todas las categorías</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {kindForCategories ? c.name : `${FINANCE_KIND_LABELS[c.kind]} · ${c.name}`}
              </option>
            ))}
          </Select>
        )}
        {show.professional && professionals.length > 0 && (
          <Select
            aria-label="Profesional"
            value={params.filters.professionalId ?? ''}
            onChange={(e) => push({ prof: e.target.value || null })}
            className="h-10 w-auto min-w-[150px] text-[13px]"
          >
            <option value="">Todo el equipo</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </Select>
        )}
        {show.method && (
          <Select
            aria-label="Método de pago"
            value={params.filters.method ?? ''}
            onChange={(e) => push({ method: e.target.value || null })}
            className="h-10 w-auto min-w-[140px] text-[13px]"
          >
            <option value="">Cualquier método</option>
            {FINANCE_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {FINANCE_PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
        )}
        {show.source && (
          <Select
            aria-label="Origen"
            value={params.filters.source ?? ''}
            onChange={(e) => push({ source: e.target.value || null })}
            className="h-10 w-auto min-w-[140px] text-[13px]"
          >
            <option value="">Cualquier origen</option>
            <option value="sessions">Cobros de citas</option>
            <option value="entries">Libro propio</option>
          </Select>
        )}
        {show.q && (
          <form
            className="relative min-w-[180px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: q.trim() || null });
            }}
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar concepto, proveedor, paciente…"
              className="h-10 pl-10 text-[13px]"
              aria-label="Buscar"
            />
          </form>
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={() =>
              push({
                kind: null,
                status: null,
                cat: null,
                prof: null,
                method: null,
                source: null,
                q: null,
              })
            }
            className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtros
          </button>
        )}
      </div>
    </div>
  );
}
