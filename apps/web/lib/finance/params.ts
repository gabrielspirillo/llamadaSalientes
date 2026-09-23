// Los parámetros de URL del módulo: lo que comparten la página (servidor), la
// barra de filtros (cliente) y la exportación CSV. Sin `server-only`.

import {
  type FinanceBasis,
  type FinancePeriod,
  type LedgerFilters,
  type ResolvedPeriod,
  isFinanceBasis,
  isFinanceKind,
  isFinancePaymentMethod,
  isFinancePeriod,
  isFinanceStatus,
  resolvePeriod,
} from '@/lib/finance/model';

export const FINANCE_TABS = ['resumen', 'movimientos', 'documentos', 'ajustes'] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

export function isFinanceTab(value: unknown): value is FinanceTab {
  return typeof value === 'string' && (FINANCE_TABS as readonly string[]).includes(value);
}

/** Pestañas que sólo ve quien administra: las cuentas y los ajustes. */
export const MANAGER_TABS: readonly FinanceTab[] = ['resumen', 'ajustes'];

export interface FinanceParams {
  tab: FinanceTab;
  period: ResolvedPeriod;
  basis: FinanceBasis;
  filters: LedgerFilters;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseFinanceParams(
  raw: RawSearchParams,
  todayKey: string,
  opts: { canManage: boolean },
): FinanceParams {
  const requestedTab = one(raw.tab);
  let tab: FinanceTab = isFinanceTab(requestedTab)
    ? requestedTab
    : opts.canManage
      ? 'resumen'
      : 'movimientos';
  if (!opts.canManage && MANAGER_TABS.includes(tab)) tab = 'movimientos';

  const periodRaw = one(raw.period);
  const period: FinancePeriod = isFinancePeriod(periodRaw) ? periodRaw : 'this_month';
  const basisRaw = one(raw.basis);
  const kind = one(raw.kind);
  const status = one(raw.status);
  const method = one(raw.method);
  const source = one(raw.source);
  const prof = one(raw.prof)?.trim();
  const cat = one(raw.cat)?.trim();
  const q = one(raw.q)?.trim();

  return {
    tab,
    period: resolvePeriod(period, todayKey, { from: one(raw.from), to: one(raw.to) }),
    basis: isFinanceBasis(basisRaw) ? basisRaw : 'cash',
    filters: {
      kind: isFinanceKind(kind) ? kind : null,
      status: isFinanceStatus(status) ? status : null,
      method: isFinancePaymentMethod(method) ? method : null,
      source: source === 'sessions' || source === 'entries' ? source : null,
      professionalId: prof && /^[0-9a-f-]{36}$/i.test(prof) ? prof : null,
      categoryId: cat && /^[0-9a-f-]{36}$/i.test(cat) ? cat : null,
      q: q ? q.slice(0, 80) : null,
    },
  };
}

/** Los parámetros tal como van en la URL, para reconstruir enlaces sin perder filtros. */
export function financeQuery(params: FinanceParams, override: Record<string, string | null> = {}) {
  const sp = new URLSearchParams();
  const base: Record<string, string | null> = {
    tab: params.tab,
    period: params.period.period,
    from: params.period.period === 'custom' ? params.period.from : null,
    to: params.period.period === 'custom' ? params.period.to : null,
    basis: params.basis,
    kind: params.filters.kind ?? null,
    status: params.filters.status ?? null,
    method: params.filters.method ?? null,
    source: params.filters.source ?? null,
    prof: params.filters.professionalId ?? null,
    cat: params.filters.categoryId ?? null,
    q: params.filters.q ?? null,
    ...override,
  };
  for (const [k, v] of Object.entries(base)) {
    if (v) sp.set(k, v);
  }
  return sp;
}

export function financeHref(params: FinanceParams, override: Record<string, string | null> = {}) {
  const qs = financeQuery(params, override).toString();
  return qs ? `/dashboard/finanzas?${qs}` : '/dashboard/finanzas';
}
