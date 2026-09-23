'use client';

import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  FINANCE_BASES,
  FINANCE_BASIS_HELP,
  FINANCE_BASIS_LABELS,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PERIODS,
  FINANCE_PERIOD_LABELS,
  type FinanceKind,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import { HelpCircle, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
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
  /** Qué controles enseñar además del período. Tipo, estado y búsqueda van a la vista; el resto, bajo «Más filtros». */
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
 *
 * A la vista sólo lo que se usa a diario (período, tipo, estado, búsqueda);
 * lo demás vive en «Más filtros» y, cuando está activo, sale como un chip
 * que se quita con un clic.
 */
export function FinanceFilters({ params, categories, professionals, show }: FinanceFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [q, setQ] = React.useState(params.filters.q ?? '');
  const [customFrom, setCustomFrom] = React.useState(params.period.from);
  const [customTo, setCustomTo] = React.useState(params.period.to);

  const { filters } = params;
  const secondaryActive =
    (show.category && filters.categoryId) ||
    (show.professional && filters.professionalId) ||
    (show.method && filters.method) ||
    (show.source && filters.source) ||
    (show.basis && params.basis !== 'cash');
  const [more, setMore] = React.useState(Boolean(secondaryActive));

  React.useEffect(() => setQ(filters.q ?? ''), [filters.q]);

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
  const hasSecondary = Boolean(
    show.basis || show.category || show.professional || show.method || show.source,
  );
  const anyFilter = Boolean(
    filters.kind ||
      filters.status ||
      filters.categoryId ||
      filters.professionalId ||
      filters.method ||
      filters.source ||
      filters.q,
  );

  const kindForCategories = filters.kind;
  const expenseCats = categories.filter((c) => c.kind === 'EXPENSE');
  const incomeCats = categories.filter((c) => c.kind === 'INCOME');

  // Chips de lo que está activo y no se ve en la primera fila.
  const chips: { key: string; label: string; clear: Record<string, string | null> }[] = [];
  if (show.basis && params.basis !== 'cash') {
    chips.push({
      key: 'basis',
      label: `Base: ${FINANCE_BASIS_LABELS[params.basis]}`,
      clear: { basis: null },
    });
  }
  if (show.category && filters.categoryId) {
    const c = categories.find((x) => x.id === filters.categoryId);
    chips.push({ key: 'cat', label: `Categoría: ${c?.name ?? '…'}`, clear: { cat: null } });
  }
  if (show.professional && filters.professionalId) {
    const p = professionals.find((x) => x.id === filters.professionalId);
    chips.push({ key: 'prof', label: `Equipo: ${p?.fullName ?? '…'}`, clear: { prof: null } });
  }
  if (show.method && filters.method) {
    chips.push({
      key: 'method',
      label: `Método: ${FINANCE_PAYMENT_METHOD_LABELS[filters.method]}`,
      clear: { method: null },
    });
  }
  if (show.source && filters.source) {
    chips.push({
      key: 'source',
      label: filters.source === 'sessions' ? 'Origen: cobros de citas' : 'Origen: libro propio',
      clear: { source: null },
    });
  }
  if (show.q && filters.q) chips.push({ key: 'q', label: `«${filters.q}»`, clear: { q: null } });

  const secondaryCount = chips.filter((c) => c.key !== 'q').length;

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
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-brand-700',
                )}
              >
                {FINANCE_PERIOD_LABELS[p]}
              </button>
            );
          })}
        </div>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden />}
        <span className="ml-auto hidden text-[12px] font-medium text-zinc-600 sm:inline">
          {params.period.label}
        </span>
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap items-end gap-2">
          <label
            htmlFor="fin-from"
            className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-700"
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
            className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-700"
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
        {show.kind && (
          <Select
            aria-label="Tipo"
            value={filters.kind ?? ''}
            onChange={(e) => push({ kind: e.target.value || null, cat: null })}
            className="h-10 w-auto min-w-[150px] text-[13px]"
          >
            <option value="">Ingresos y gastos</option>
            <option value="INCOME">Sólo ingresos</option>
            <option value="EXPENSE">Sólo gastos</option>
          </Select>
        )}
        {show.status && (
          <Select
            aria-label="Estado"
            value={filters.status ?? ''}
            onChange={(e) => push({ status: e.target.value || null })}
            className="h-10 w-auto min-w-[130px] text-[13px]"
          >
            <option value="">Todos los estados</option>
            <option value="PAID">Pagados / cobrados</option>
            <option value="PENDING">Pendientes</option>
          </Select>
        )}
        {show.q && (
          <form
            className="relative min-w-[160px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: q.trim() || null });
            }}
          >
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              className="h-10 pl-10 text-[13px] placeholder:text-zinc-500"
              aria-label="Buscar por concepto, proveedor o paciente"
            />
          </form>
        )}
        {hasSecondary && (
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
              more || secondaryCount > 0
                ? 'border-brand-200 bg-brand-50 text-brand-800'
                : 'border-(--color-border) bg-white text-zinc-700 hover:bg-zinc-50',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Más filtros
            {secondaryCount > 0 && (
              <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] text-white">
                {secondaryCount}
              </span>
            )}
          </button>
        )}
        {anyFilter && (
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
                basis: null,
              })
            }
            className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-[13px] font-semibold text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtros
          </button>
        )}
      </div>

      {more && hasSecondary && (
        <div className="flex flex-wrap items-center gap-2 border-t border-(--color-border-subtle) pt-3">
          {show.basis && (
            <div className="flex items-center gap-1.5">
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
                      title={FINANCE_BASIS_HELP[b]}
                      onClick={() => push({ basis: b === 'cash' ? null : b })}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
                        active
                          ? 'bg-brand-100 text-brand-800'
                          : 'text-zinc-600 hover:text-zinc-900',
                      )}
                    >
                      {FINANCE_BASIS_LABELS[b]}
                    </button>
                  );
                })}
              </fieldset>
              <span
                className="inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100"
                title={`${FINANCE_BASIS_LABELS.cash}: ${FINANCE_BASIS_HELP.cash} ${FINANCE_BASIS_LABELS.accrual}: ${FINANCE_BASIS_HELP.accrual}`}
                aria-label="Qué significa cobrado o facturado"
              >
                <HelpCircle className="h-4 w-4" />
              </span>
            </div>
          )}
          {show.category && (
            <Select
              aria-label="Categoría"
              value={filters.categoryId ?? ''}
              onChange={(e) => push({ cat: e.target.value || null })}
              className="h-10 w-auto min-w-[170px] text-[13px]"
            >
              <option value="">Todas las categorías</option>
              {kindForCategories !== 'INCOME' && expenseCats.length > 0 && (
                <optgroup label="Gastos">
                  {expenseCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {kindForCategories !== 'EXPENSE' && incomeCats.length > 0 && (
                <optgroup label="Ingresos">
                  {incomeCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
          {show.professional && professionals.length > 0 && (
            <Select
              aria-label="Profesional"
              value={filters.professionalId ?? ''}
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
              value={filters.method ?? ''}
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
              value={filters.source ?? ''}
              onChange={(e) => push({ source: e.target.value || null })}
              className="h-10 w-auto min-w-[150px] text-[13px]"
            >
              <option value="">Cualquier origen</option>
              <option value="sessions">Cobros de citas</option>
              <option value="entries">Libro propio</option>
            </Select>
          )}
        </div>
      )}

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtros activos">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={() => push(chip.clear)}
                className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-2 text-[12px] font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100"
                aria-label={`Quitar filtro ${chip.label}`}
              >
                {chip.label}
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
