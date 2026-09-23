// Módulo Finanzas: lo puro.
//
// Todo lo que el panel dibuja sale de aquí: cómo se resuelve un período, qué
// cuenta en caja y qué en devengo, las sumas, las series, el punto de
// equilibrio y el semáforo de salud. Sin base de datos y sin `server-only`, a
// propósito: el servidor, el cliente y los tests hablan el mismo idioma.
//
// Convenciones:
//   - Las fechas son claves 'YYYY-MM-DD' de calendario, no instantes. Un
//     alquiler es "de marzo", no de un momento.
//   - Los importes van en céntimos enteros. `null` = "sin importe fijado"
//     (una sesión atendida cuyo tratamiento no tiene precio): no suma, pero
//     cuenta como pendiente.

import { type ChargeFileKind, formatCents } from '@/lib/agenda/billing';
import { addDaysToKey, daysBetweenKeys, parseDateKey, weekdayOfKey } from '@/lib/tasks/tz';

export { formatCents };

// ─── Catálogos ──────────────────────────────────────────────────────────────

export const FINANCE_KINDS = ['INCOME', 'EXPENSE'] as const;
export type FinanceKind = (typeof FINANCE_KINDS)[number];
export const FINANCE_KIND_LABELS: Record<FinanceKind, string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Gasto',
};
export function isFinanceKind(value: unknown): value is FinanceKind {
  return typeof value === 'string' && (FINANCE_KINDS as readonly string[]).includes(value);
}

export const FINANCE_PAYMENT_METHODS = [
  'CARD',
  'CASH',
  'BIZUM',
  'TRANSFER',
  'DIRECT_DEBIT',
] as const;
export type FinancePaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];
export const FINANCE_PAYMENT_METHOD_LABELS: Record<FinancePaymentMethod, string> = {
  CARD: 'Tarjeta',
  CASH: 'Efectivo',
  BIZUM: 'Bizum',
  TRANSFER: 'Transferencia',
  DIRECT_DEBIT: 'Domiciliación',
};
export function isFinancePaymentMethod(value: unknown): value is FinancePaymentMethod {
  return (
    typeof value === 'string' && (FINANCE_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

export type FinanceStatus = 'PENDING' | 'PAID';
export const FINANCE_STATUS_LABELS: Record<FinanceStatus, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
};
export function isFinanceStatus(value: unknown): value is FinanceStatus {
  return value === 'PENDING' || value === 'PAID';
}

export const FINANCE_PERIODS = [
  'this_month',
  'last_month',
  'quarter',
  'year',
  'last_12m',
  'custom',
] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];
export const FINANCE_PERIOD_LABELS: Record<FinancePeriod, string> = {
  this_month: 'Este mes',
  last_month: 'Mes pasado',
  quarter: 'Este trimestre',
  year: 'Este año',
  last_12m: 'Últimos 12 meses',
  custom: 'Personalizado',
};
export function isFinancePeriod(value: unknown): value is FinancePeriod {
  return typeof value === 'string' && (FINANCE_PERIODS as readonly string[]).includes(value);
}

/**
 * Caja = cuenta cuando el dinero se mueve (sólo lo pagado, por fecha de
 * pago). Devengo = cuenta cuando se genera (por fecha del gasto o de la
 * sesión, esté pagado o no). Para una clínica pequeña caja es lo intuitivo;
 * devengo es lo que pide la gestoría.
 */
export const FINANCE_BASES = ['cash', 'accrual'] as const;
export type FinanceBasis = (typeof FINANCE_BASES)[number];
export const FINANCE_BASIS_LABELS: Record<FinanceBasis, string> = {
  cash: 'Caja',
  accrual: 'Devengo',
};
export function isFinanceBasis(value: unknown): value is FinanceBasis {
  return value === 'cash' || value === 'accrual';
}

/** De dónde sale cada línea del libro unificado. */
export type LedgerSource = 'entry' | 'charge' | 'appointment';

export interface LedgerFile {
  id: string;
  name: string;
  kind: ChargeFileKind;
}

/**
 * Una línea del libro. Las tres fuentes se normalizan a esto:
 *   - `entry`: un movimiento propio del módulo (alquiler, luz, un producto).
 *   - `charge`: el cobro de una cita (`patient_charges`), tal como lo dejó la
 *     ficha del paciente.
 *   - `appointment`: una sesión ya atendida SIN cobro registrado. Es la fuga
 *     de ingresos que un dueño quiere ver, no esconder.
 */
export interface LedgerLine {
  /** Clave estable para la UI: '<source>:<id>'. */
  key: string;
  source: LedgerSource;
  sourceId: string;
  kind: FinanceKind;
  concept: string;
  counterparty: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Coste fijo (por su categoría). Sólo tiene sentido en gastos. */
  isFixed: boolean;
  amountCents: number | null;
  /** IVA incluido en el importe, si se desglosó. Sólo en el libro propio. */
  taxCents: number;
  status: FinanceStatus;
  /** Devengo: 'YYYY-MM-DD'. */
  occurredOn: string;
  /** Caja: 'YYYY-MM-DD'. Null mientras está pendiente. */
  paidOn: string | null;
  paymentMethod: FinancePaymentMethod | null;
  professionalId: string | null;
  professionalName: string | null;
  treatmentName: string | null;
  patientKey: string | null;
  patientName: string | null;
  isRecurring: boolean;
  notes: string | null;
  files: LedgerFile[];
}

// ─── Fechas ─────────────────────────────────────────────────────────────────

export interface DateRange {
  from: string;
  to: string;
}

function keyOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseDateKey(value) !== null;
}

/** 'YYYY-MM' de una clave. */
export function monthKeyOf(key: string): string {
  return key.slice(0, 7);
}

export function startOfMonthKey(key: string): string {
  const p = parseDateKey(key);
  if (!p) return key;
  return keyOf(p.year, p.month, 1);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function endOfMonthKey(key: string): string {
  const p = parseDateKey(key);
  if (!p) return key;
  return keyOf(p.year, p.month, daysInMonth(p.year, p.month));
}

/** Suma meses manteniendo el día cuando existe; si no, el último del mes. */
export function addMonthsToKey(key: string, months: number): string {
  const p = parseDateKey(key);
  if (!p) return key;
  const total = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return keyOf(year, month, Math.min(p.day, daysInMonth(year, month)));
}

export interface ResolvedPeriod extends DateRange {
  period: FinancePeriod;
  /** El tramo equivalente anterior, para las comparativas. */
  previous: DateRange;
  label: string;
}

/**
 * Resuelve un período a un rango de claves inclusivo y su tramo anterior.
 *
 * Los períodos "en curso" (este mes, trimestre, año) van hasta HOY, y el
 * anterior es el mismo tramo transcurrido: comparar los 23 días que van de
 * septiembre contra agosto entero diría que el mes va fatal.
 */
export function resolvePeriod(
  period: FinancePeriod,
  todayKey: string,
  custom?: { from?: string | null; to?: string | null },
): ResolvedPeriod {
  const today = parseDateKey(todayKey) ?? { year: 1970, month: 1, day: 1 };

  if (period === 'custom' && isDateKey(custom?.from) && isDateKey(custom?.to)) {
    let from = custom.from;
    let to = custom.to;
    if (from > to) [from, to] = [to, from];
    const length = daysBetweenKeys(from, to) + 1;
    const prevTo = addDaysToKey(from, -1);
    return {
      period,
      from,
      to,
      previous: { from: addDaysToKey(prevTo, -(length - 1)), to: prevTo },
      label: `${formatDateKey(from)} – ${formatDateKey(to)}`,
    };
  }

  if (period === 'last_month') {
    const firstOfThis = keyOf(today.year, today.month, 1);
    const from = addMonthsToKey(firstOfThis, -1);
    const to = endOfMonthKey(from);
    const prevFrom = addMonthsToKey(from, -1);
    return {
      period,
      from,
      to,
      previous: { from: prevFrom, to: endOfMonthKey(prevFrom) },
      label: monthLabel(monthKeyOf(from)),
    };
  }

  if (period === 'quarter') {
    const qStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
    const from = keyOf(today.year, qStartMonth, 1);
    const to = todayKey;
    return {
      period,
      from,
      to,
      previous: { from: addMonthsToKey(from, -3), to: addMonthsToKey(to, -3) },
      label: `T${Math.floor((today.month - 1) / 3) + 1} ${today.year}`,
    };
  }

  if (period === 'year') {
    const from = keyOf(today.year, 1, 1);
    const to = todayKey;
    return {
      period,
      from,
      to,
      previous: { from: addMonthsToKey(from, -12), to: addMonthsToKey(to, -12) },
      label: String(today.year),
    };
  }

  if (period === 'last_12m') {
    const from = addMonthsToKey(keyOf(today.year, today.month, 1), -11);
    const to = todayKey;
    return {
      period,
      from,
      to,
      previous: { from: addMonthsToKey(from, -12), to: addMonthsToKey(to, -12) },
      label: 'Últimos 12 meses',
    };
  }

  // this_month (y custom sin fechas válidas)
  const from = keyOf(today.year, today.month, 1);
  const to = todayKey;
  return {
    period: 'this_month',
    from,
    to,
    previous: { from: addMonthsToKey(from, -1), to: addMonthsToKey(to, -1) },
    label: monthLabel(monthKeyOf(from)),
  };
}

export type Granularity = 'day' | 'week' | 'month';

/** Un mes se lee por días, un trimestre por semanas, un año por meses. */
export function granularityFor(range: DateRange): Granularity {
  const days = daysBetweenKeys(range.from, range.to) + 1;
  if (days <= 31) return 'day';
  if (days <= 140) return 'week';
  return 'month';
}

/** La clave del cubo al que cae un día: el día, el lunes de su semana o su mes. */
export function bucketKeyFor(key: string, granularity: Granularity): string {
  if (granularity === 'day') return key;
  if (granularity === 'week') return addDaysToKey(key, -(weekdayOfKey(key) - 1));
  return monthKeyOf(key);
}

/** Todos los cubos del rango, con los vacíos: un mes sin gastos se dibuja a cero. */
export function enumerateBuckets(range: DateRange, granularity: Granularity): string[] {
  const out: string[] = [];
  let cursor = bucketKeyFor(range.from, granularity);
  const last = bucketKeyFor(range.to, granularity);
  let guard = 0;
  while (cursor <= last && guard < 1000) {
    out.push(cursor);
    guard += 1;
    if (granularity === 'day') cursor = addDaysToKey(cursor, 1);
    else if (granularity === 'week') cursor = addDaysToKey(cursor, 7);
    else cursor = monthKeyOf(addMonthsToKey(`${cursor}-01`, 1));
  }
  return out;
}

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];
const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "22 sept 2026" (o "22 sept" sin año). Sin Intl: el resultado no depende del runtime. */
export function formatDateKey(key: string, opts: { year?: boolean } = {}): string {
  const p = parseDateKey(key);
  if (!p) return key;
  const base = `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
  return opts.year === false ? base : `${base} ${p.year}`;
}

/** "septiembre 2026" a partir de 'YYYY-MM'. */
export function monthLabel(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(monthKey);
  if (!m) return monthKey;
  return `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
}

export function bucketLabel(bucketKey: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const m = /^(\d{4})-(\d{2})/.exec(bucketKey);
    if (!m) return bucketKey;
    return `${MONTHS_SHORT[Number(m[2]) - 1]} ${(m[1] ?? '').slice(2)}`;
  }
  return formatDateKey(bucketKey, { year: false });
}

// ─── Base y filtros ─────────────────────────────────────────────────────────

/** La fecha por la que cuenta la línea en esa base, o null si no cuenta. */
export function effectiveDate(line: LedgerLine, basis: FinanceBasis): string | null {
  if (basis === 'cash') {
    return line.status === 'PAID' ? (line.paidOn ?? line.occurredOn) : null;
  }
  return line.occurredOn;
}

export function inRange(key: string, range: DateRange): boolean {
  return key >= range.from && key <= range.to;
}

/** Las líneas que caen en el período según la base. */
export function linesInPeriod(
  lines: LedgerLine[],
  basis: FinanceBasis,
  range: DateRange,
): LedgerLine[] {
  return lines.filter((l) => {
    const d = effectiveDate(l, basis);
    return d !== null && inRange(d, range);
  });
}

export interface LedgerFilters {
  kind?: FinanceKind | null;
  status?: FinanceStatus | null;
  categoryId?: string | null;
  professionalId?: string | null;
  method?: FinancePaymentMethod | null;
  /** 'sessions' = lo que viene de las citas; 'entries' = el libro propio. */
  source?: 'sessions' | 'entries' | null;
  q?: string | null;
}

export function matchesFilters(line: LedgerLine, f: LedgerFilters): boolean {
  if (f.kind && line.kind !== f.kind) return false;
  if (f.status && line.status !== f.status) return false;
  if (f.categoryId && line.categoryId !== f.categoryId) return false;
  if (f.professionalId && line.professionalId !== f.professionalId) return false;
  if (f.method && line.paymentMethod !== f.method) return false;
  if (f.source === 'sessions' && line.source === 'entry') return false;
  if (f.source === 'entries' && line.source !== 'entry') return false;
  if (f.q) {
    const needle = f.q.trim().toLowerCase();
    if (needle) {
      const hay = [
        line.concept,
        line.counterparty,
        line.categoryName,
        line.patientName,
        line.professionalName,
        line.treatmentName,
        line.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
  }
  return true;
}

/** Las líneas que interesan en Movimientos: caen en el rango por devengo O por caja. */
export function linesTouchingRange(lines: LedgerLine[], range: DateRange): LedgerLine[] {
  return lines.filter(
    (l) => inRange(l.occurredOn, range) || (l.paidOn !== null && inRange(l.paidOn, range)),
  );
}

/** Orden del libro: lo más reciente arriba, por la fecha que manda en cada base. */
export function sortLedger(lines: LedgerLine[], basis: FinanceBasis): LedgerLine[] {
  return [...lines].sort((a, b) => {
    const da = effectiveDate(a, basis) ?? a.occurredOn;
    const db = effectiveDate(b, basis) ?? b.occurredOn;
    if (da !== db) return da < db ? 1 : -1;
    return a.key < b.key ? 1 : -1;
  });
}

// ─── Resumen ────────────────────────────────────────────────────────────────

export interface BreakdownRow {
  id: string;
  name: string;
  cents: number;
  count: number;
}

export interface FinanceSummary {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Resultado / ingresos, en %. Null sin ingresos. */
  marginPct: number | null;
  /** Sesiones cobradas (caja) o atendidas con importe (devengo). */
  sessions: number;
  /** Ingresos de sesiones / sesiones. Null sin sesiones. */
  avgTicketCents: number | null;
  sessionsIncomeCents: number;
  otherIncomeCents: number;
  fixedCents: number;
  variableCents: number;
  incomeByMethod: BreakdownRow[];
  expenseByCategory: (BreakdownRow & { isFixed: boolean })[];
  incomeByCategory: BreakdownRow[];
  incomeByProfessional: (BreakdownRow & { sessions: number })[];
  incomeByTreatment: (BreakdownRow & { sessions: number })[];
}

function bump<T extends BreakdownRow>(
  map: Map<string, T>,
  id: string,
  make: () => T,
  cents: number,
): T {
  const row = map.get(id) ?? make();
  row.cents += cents;
  row.count += 1;
  map.set(id, row);
  return row;
}

function sortedRows<T extends BreakdownRow>(map: Map<string, T>): T[] {
  return [...map.values()].sort((a, b) => b.cents - a.cents);
}

/** Suma un conjunto de líneas YA acotado al período (ver `linesInPeriod`). */
export function summarizeLedger(lines: LedgerLine[]): FinanceSummary {
  let income = 0;
  let expense = 0;
  let sessions = 0;
  let sessionsIncome = 0;
  let otherIncome = 0;
  let fixed = 0;
  let variable = 0;
  const byMethod = new Map<string, BreakdownRow>();
  const expenseByCategory = new Map<string, BreakdownRow & { isFixed: boolean }>();
  const incomeByCategory = new Map<string, BreakdownRow>();
  const byProfessional = new Map<string, BreakdownRow & { sessions: number }>();
  const byTreatment = new Map<string, BreakdownRow & { sessions: number }>();

  for (const l of lines) {
    if (l.amountCents === null) continue;
    const cents = l.amountCents;
    if (l.kind === 'INCOME') {
      income += cents;
      const isSession = l.source !== 'entry';
      if (isSession) {
        sessions += 1;
        sessionsIncome += cents;
      } else {
        otherIncome += cents;
      }
      if (l.paymentMethod) {
        bump(
          byMethod,
          l.paymentMethod,
          () => ({
            id: l.paymentMethod as string,
            name: FINANCE_PAYMENT_METHOD_LABELS[l.paymentMethod as FinancePaymentMethod],
            cents: 0,
            count: 0,
          }),
          cents,
        );
      }
      const catId = isSession ? 'sessions' : (l.categoryId ?? 'none');
      bump(
        incomeByCategory,
        catId,
        () => ({
          id: catId,
          name: isSession ? 'Sesiones' : (l.categoryName ?? 'Sin categoría'),
          cents: 0,
          count: 0,
        }),
        cents,
      );
      if (l.professionalId) {
        const row = bump(
          byProfessional,
          l.professionalId,
          () => ({
            id: l.professionalId as string,
            name: l.professionalName ?? 'Profesional',
            cents: 0,
            count: 0,
            sessions: 0,
          }),
          cents,
        );
        if (isSession) row.sessions += 1;
      }
      if (isSession) {
        const name = l.treatmentName ?? 'Sesión';
        const row = bump(
          byTreatment,
          name,
          () => ({ id: name, name, cents: 0, count: 0, sessions: 0 }),
          cents,
        );
        row.sessions += 1;
      }
    } else {
      expense += cents;
      if (l.isFixed) fixed += cents;
      else variable += cents;
      const catId = l.categoryId ?? 'none';
      bump(
        expenseByCategory,
        catId,
        () => ({
          id: catId,
          name: l.categoryName ?? 'Sin categoría',
          cents: 0,
          count: 0,
          isFixed: l.isFixed,
        }),
        cents,
      );
    }
  }

  const net = income - expense;
  return {
    incomeCents: income,
    expenseCents: expense,
    netCents: net,
    marginPct: income > 0 ? Math.round((net / income) * 1000) / 10 : null,
    sessions,
    avgTicketCents: sessions > 0 ? Math.round(sessionsIncome / sessions) : null,
    sessionsIncomeCents: sessionsIncome,
    otherIncomeCents: otherIncome,
    fixedCents: fixed,
    variableCents: variable,
    incomeByMethod: sortedRows(byMethod),
    expenseByCategory: sortedRows(expenseByCategory),
    incomeByCategory: sortedRows(incomeByCategory),
    incomeByProfessional: sortedRows(byProfessional),
    incomeByTreatment: sortedRows(byTreatment),
  };
}

/** Variación en % respecto al anterior, redondeada. Null si no hay con qué comparar. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

// ─── Saldos abiertos (a una fecha, no de un período) ────────────────────────

export interface OpenBalances {
  receivables: LedgerLine[];
  receivableCents: number;
  /** Sesiones atendidas sin cobro registrado (o sin importe): la fuga. */
  unbilledSessions: number;
  payables: LedgerLine[];
  payableCents: number;
}

/**
 * Lo pendiente de cobrar y de pagar a fecha `asOf`. Es un saldo, no un flujo:
 * una factura de hace tres meses sin pagar sigue pendiente hoy aunque el
 * período elegido sea "este mes".
 */
export function openBalances(lines: LedgerLine[], asOf: string): OpenBalances {
  const receivables: LedgerLine[] = [];
  const payables: LedgerLine[] = [];
  let receivableCents = 0;
  let payableCents = 0;
  let unbilled = 0;
  for (const l of lines) {
    if (l.status !== 'PENDING' || l.occurredOn > asOf) continue;
    if (l.kind === 'INCOME') {
      receivables.push(l);
      if (l.amountCents !== null) receivableCents += l.amountCents;
      if (l.source === 'appointment' || l.amountCents === null) unbilled += 1;
    } else {
      payables.push(l);
      if (l.amountCents !== null) payableCents += l.amountCents;
    }
  }
  const byDate = (a: LedgerLine, b: LedgerLine) => (a.occurredOn < b.occurredOn ? -1 : 1);
  receivables.sort(byDate);
  payables.sort(byDate);
  return { receivables, receivableCents, unbilledSessions: unbilled, payables, payableCents };
}

export interface AgingBucket {
  label: string;
  count: number;
  cents: number;
}

/** Antigüedad de lo pendiente: cuánto lleva sin cobrar (o sin pagar). */
export function agingBuckets(lines: LedgerLine[], todayKey: string): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: '0–30 días', count: 0, cents: 0 },
    { label: '31–60 días', count: 0, cents: 0 },
    { label: '61–90 días', count: 0, cents: 0 },
    { label: 'Más de 90 días', count: 0, cents: 0 },
  ];
  for (const l of lines) {
    const age = daysBetweenKeys(l.occurredOn, todayKey);
    const idx = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    const b = buckets[idx];
    if (!b) continue;
    b.count += 1;
    b.cents += l.amountCents ?? 0;
  }
  return buckets;
}

// ─── Series ─────────────────────────────────────────────────────────────────

export interface SeriesPoint {
  key: string;
  label: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  cumulativeNetCents: number;
}

export interface FinanceSeries {
  granularity: Granularity;
  points: SeriesPoint[];
}

/** Ingresos, gastos y resultado por cubo (día, semana o mes) con los vacíos a cero. */
export function buildSeries(
  lines: LedgerLine[],
  basis: FinanceBasis,
  range: DateRange,
): FinanceSeries {
  const granularity = granularityFor(range);
  const keys = enumerateBuckets(range, granularity);
  const map = new Map<string, SeriesPoint>(
    keys.map((k) => [
      k,
      {
        key: k,
        label: bucketLabel(k, granularity),
        incomeCents: 0,
        expenseCents: 0,
        netCents: 0,
        cumulativeNetCents: 0,
      },
    ]),
  );
  for (const l of linesInPeriod(lines, basis, range)) {
    if (l.amountCents === null) continue;
    const d = effectiveDate(l, basis);
    if (!d) continue;
    const point = map.get(bucketKeyFor(d, granularity));
    if (!point) continue;
    if (l.kind === 'INCOME') point.incomeCents += l.amountCents;
    else point.expenseCents += l.amountCents;
  }
  let cumulative = 0;
  const points = keys.map((k) => {
    const p = map.get(k) as SeriesPoint;
    p.netCents = p.incomeCents - p.expenseCents;
    cumulative += p.netCents;
    p.cumulativeNetCents = cumulative;
    return p;
  });
  return { granularity, points };
}

// ─── Punto de equilibrio ────────────────────────────────────────────────────

export interface BreakEven {
  /** Meses que abarca el período (23 días = 0,76 meses). */
  months: number;
  fixedMonthlyCents: number;
  variablePerSessionCents: number;
  avgTicketCents: number | null;
  /** Lo que deja cada sesión después de su coste variable. */
  contributionCents: number | null;
  /** Sesiones al mes para cubrir los fijos. Null si no se puede calcular. */
  sessionsPerMonth: number | null;
  revenuePerMonthCents: number | null;
  /** Sesiones cobradas en el período, ya al mes. */
  sessionsPerMonthActual: number;
  /** Ingresos / gastos fijos. >1 = los fijos están cubiertos. Null sin fijos. */
  fixedCoverage: number | null;
}

export function monthsInRange(range: DateRange): number {
  const days = daysBetweenKeys(range.from, range.to) + 1;
  return Math.max(days / 30.4375, 1 / 30.4375);
}

/**
 * Cuántas sesiones al mes necesita la clínica para no perder dinero:
 * fijos mensuales / (ticket medio − coste variable por sesión).
 *
 * Si el ticket no cubre ni el variable de la sesión, no hay número de sesiones
 * que lo arregle: `sessionsPerMonth` es null y el panel lo dice.
 */
export function breakEven(summary: FinanceSummary, range: DateRange): BreakEven {
  const months = monthsInRange(range);
  const fixedMonthly = Math.round(summary.fixedCents / months);
  const variablePerSession =
    summary.sessions > 0 ? Math.round(summary.variableCents / summary.sessions) : 0;
  const ticket = summary.avgTicketCents;
  const contribution = ticket === null ? null : ticket - variablePerSession;
  const sessionsPerMonth =
    contribution !== null && contribution > 0 ? Math.ceil(fixedMonthly / contribution) : null;
  return {
    months,
    fixedMonthlyCents: fixedMonthly,
    variablePerSessionCents: variablePerSession,
    avgTicketCents: ticket,
    contributionCents: contribution,
    sessionsPerMonth,
    revenuePerMonthCents:
      sessionsPerMonth !== null && ticket !== null ? sessionsPerMonth * ticket : null,
    sessionsPerMonthActual: Math.round((summary.sessions / months) * 10) / 10,
    fixedCoverage: summary.fixedCents > 0 ? summary.incomeCents / summary.fixedCents : null,
  };
}

// ─── Semáforo de salud ──────────────────────────────────────────────────────

export type SignalLevel = 'ok' | 'warn' | 'bad' | 'na';

export interface HealthSignal {
  key: string;
  label: string;
  level: SignalLevel;
  /** El dato, ya formateado ("32 %", "1,8×"). */
  value: string;
  /** Qué significa y qué mirar. */
  detail: string;
}

export type HealthOverall = 'healthy' | 'watch' | 'risk' | 'na';

export interface HealthReport {
  signals: HealthSignal[];
  overall: HealthOverall;
  /** 0–100. Media de las señales con dato. */
  score: number | null;
}

export const HEALTH_OVERALL_LABELS: Record<HealthOverall, string> = {
  healthy: 'Negocio sano',
  watch: 'Para vigilar',
  risk: 'En riesgo',
  na: 'Sin datos suficientes',
};

/** Umbrales del semáforo. Expuestos para los tests y para que se lean de un vistazo. */
export const HEALTH_THRESHOLDS = {
  /** Margen neto: verde desde el 30 %, rojo por debajo del 10 %. */
  margin: { ok: 30, warn: 10 },
  /** Ingresos vs período anterior: verde si crecen ≥5 %, rojo si caen >5 %. */
  growth: { ok: 5, warn: -5 },
  /** Pendiente de cobro sobre ingresos del período. */
  receivables: { ok: 10, warn: 25 },
  /** Ingresos / gastos fijos. */
  coverage: { ok: 1.5, warn: 1 },
  /** Peso del profesional que más factura. */
  concentration: { ok: 60, warn: 85 },
  /** Sesiones atendidas sin cobro registrado. */
  unbilled: { ok: 0, warn: 3 },
} as const;

function pct(n: number): string {
  return `${Math.round(n)} %`;
}

export function healthReport(input: {
  current: FinanceSummary;
  previous: FinanceSummary;
  open: OpenBalances;
  breakEven: BreakEven;
}): HealthReport {
  const { current, previous, open, breakEven: be } = input;
  const signals: HealthSignal[] = [];
  const T = HEALTH_THRESHOLDS;

  // 1. Margen neto
  if (current.marginPct === null) {
    signals.push({
      key: 'margin',
      label: 'Margen neto',
      level: 'na',
      value: '—',
      detail: 'Sin ingresos en el período no hay margen que medir.',
    });
  } else {
    const m = current.marginPct;
    signals.push({
      key: 'margin',
      label: 'Margen neto',
      level: m >= T.margin.ok ? 'ok' : m >= T.margin.warn ? 'warn' : 'bad',
      value: pct(m),
      detail:
        m >= T.margin.ok
          ? 'De cada 100 € que entran quedan más de 30 después de pagar todo.'
          : m >= T.margin.warn
            ? 'El margen es estrecho: un mes flojo se come el resultado.'
            : m < 0
              ? 'Se gasta más de lo que entra. Revisa los fijos y el precio de sesión.'
              : 'Casi todo lo que entra se va en gastos.',
    });
  }

  // 2. Tendencia de ingresos
  const growth = deltaPct(current.incomeCents, previous.incomeCents);
  if (growth === null) {
    signals.push({
      key: 'growth',
      label: 'Ingresos vs anterior',
      level: 'na',
      value: '—',
      detail: 'Todavía no hay un período anterior con el que comparar.',
    });
  } else {
    signals.push({
      key: 'growth',
      label: 'Ingresos vs anterior',
      level: growth >= T.growth.ok ? 'ok' : growth >= T.growth.warn ? 'warn' : 'bad',
      value: `${growth > 0 ? '+' : ''}${growth} %`,
      detail:
        growth >= T.growth.ok
          ? 'Los ingresos crecen respecto al tramo anterior.'
          : growth >= T.growth.warn
            ? 'Ingresos planos: ni crecen ni caen.'
            : 'Los ingresos caen. Mira la agenda: ¿menos sesiones o menos ticket?',
    });
  }

  // 3. Pendiente de cobro
  if (current.incomeCents === 0 && open.receivableCents === 0) {
    signals.push({
      key: 'receivables',
      label: 'Pendiente de cobro',
      level: 'na',
      value: '—',
      detail: 'Nada cobrado ni pendiente en el período.',
    });
  } else {
    const ratio =
      current.incomeCents > 0 ? (open.receivableCents / current.incomeCents) * 100 : 100;
    signals.push({
      key: 'receivables',
      label: 'Pendiente de cobro',
      level: ratio <= T.receivables.ok ? 'ok' : ratio <= T.receivables.warn ? 'warn' : 'bad',
      value: formatCents(open.receivableCents),
      detail:
        ratio <= T.receivables.ok
          ? 'Lo pendiente es pequeño frente a lo que entra.'
          : ratio <= T.receivables.warn
            ? 'Hay dinero por cobrar que pesa: revisa las sesiones pendientes.'
            : 'Lo pendiente de cobro es una parte grande de los ingresos. Cobra antes de que envejezca.',
    });
  }

  // 4. Cobertura de fijos
  if (be.fixedCoverage === null) {
    signals.push({
      key: 'coverage',
      label: 'Cobertura de fijos',
      level: 'na',
      value: '—',
      detail: 'Sin gastos marcados como fijos no se puede medir. Márcalos en Ajustes.',
    });
  } else {
    const c = be.fixedCoverage;
    signals.push({
      key: 'coverage',
      label: 'Cobertura de fijos',
      level: c >= T.coverage.ok ? 'ok' : c >= T.coverage.warn ? 'warn' : 'bad',
      value: `${(Math.round(c * 10) / 10).toString().replace('.', ',')}×`,
      detail:
        c >= T.coverage.ok
          ? 'Los ingresos cubren los gastos fijos con holgura.'
          : c >= T.coverage.warn
            ? 'Los ingresos cubren los fijos, pero por poco.'
            : 'Los ingresos no llegan a cubrir los gastos fijos del período.',
    });
  }

  // 5. Concentración por profesional
  const profs = current.incomeByProfessional;
  if (profs.length < 2 || current.incomeCents === 0) {
    signals.push({
      key: 'concentration',
      label: 'Dependencia de un profesional',
      level: 'na',
      value: '—',
      detail:
        profs.length < 2
          ? 'Con un solo profesional facturando no aplica.'
          : 'Sin ingresos atribuidos en el período.',
    });
  } else {
    const top = profs[0] as BreakdownRow;
    const share = (top.cents / current.incomeCents) * 100;
    signals.push({
      key: 'concentration',
      label: 'Dependencia de un profesional',
      level: share < T.concentration.ok ? 'ok' : share <= T.concentration.warn ? 'warn' : 'bad',
      value: `${top.name}: ${pct(share)}`,
      detail:
        share < T.concentration.ok
          ? 'Los ingresos están repartidos entre el equipo.'
          : share <= T.concentration.warn
            ? 'Buena parte de los ingresos depende de una persona.'
            : 'Casi todo depende de una persona: una baja deja la clínica sin ingresos.',
    });
  }

  // 6. Fuga de cobro
  const u = open.unbilledSessions;
  signals.push({
    key: 'unbilled',
    label: 'Sesiones sin cobro registrado',
    level: u <= T.unbilled.ok ? 'ok' : u <= T.unbilled.warn ? 'warn' : 'bad',
    value: String(u),
    detail:
      u === 0
        ? 'Todas las sesiones atendidas tienen su cobro.'
        : u <= T.unbilled.warn
          ? 'Alguna sesión atendida no tiene el cobro registrado. Regístralo desde la ficha.'
          : 'Varias sesiones atendidas sin cobro: o no se cobraron, o no se apuntaron. Las dos cosas cuestan dinero.',
  });

  // 7. Punto de equilibrio
  if (be.sessionsPerMonth === null) {
    signals.push({
      key: 'breakeven',
      label: 'Punto de equilibrio',
      level: be.fixedMonthlyCents > 0 && be.avgTicketCents !== null ? 'bad' : 'na',
      value: '—',
      detail:
        be.avgTicketCents === null
          ? 'Sin sesiones cobradas no se sabe cuántas hacen falta.'
          : be.fixedMonthlyCents === 0
            ? 'Sin gastos fijos registrados el punto de equilibrio es cero.'
            : 'El precio de sesión no cubre ni su coste variable: no hay número de sesiones que lo arregle.',
    });
  } else {
    const ratio = be.sessionsPerMonthActual / be.sessionsPerMonth;
    signals.push({
      key: 'breakeven',
      label: 'Punto de equilibrio',
      level: ratio >= 1.2 ? 'ok' : ratio >= 1 ? 'warn' : 'bad',
      value: `${be.sessionsPerMonth} sesiones/mes`,
      detail:
        ratio >= 1.2
          ? `Se hacen ${be.sessionsPerMonthActual} al mes: por encima del mínimo con margen.`
          : ratio >= 1
            ? `Se hacen ${be.sessionsPerMonthActual} al mes: justo por encima del mínimo.`
            : `Se hacen ${be.sessionsPerMonthActual} al mes y hacen falta ${be.sessionsPerMonth} para cubrir los fijos.`,
    });
  }

  const scored = signals.filter((s) => s.level !== 'na');
  if (scored.length === 0) return { signals, overall: 'na', score: null };
  const score = Math.round(
    scored.reduce((acc, s) => acc + (s.level === 'ok' ? 100 : s.level === 'warn' ? 50 : 0), 0) /
      scored.length,
  );
  const bad = scored.filter((s) => s.level === 'bad').length;
  const warn = scored.filter((s) => s.level === 'warn').length;
  const overall: HealthOverall =
    bad >= 2 || score < 40 ? 'risk' : bad >= 1 || warn >= 2 ? 'watch' : 'healthy';
  return { signals, overall, score };
}

// ─── Categorías por defecto ─────────────────────────────────────────────────

export interface DefaultCategory {
  slug: string;
  name: string;
  isFixed: boolean;
}

/** Lo que se siembra a una clínica al abrir el módulo. Se renombran o archivan, no se borran. */
export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  { slug: 'alquiler', name: 'Alquiler y local', isFixed: true },
  { slug: 'nominas', name: 'Nóminas y Seguridad Social', isFixed: true },
  { slug: 'autonomos', name: 'Cuota de autónomos', isFixed: true },
  { slug: 'suministros', name: 'Suministros (luz, agua, internet)', isFixed: true },
  { slug: 'software', name: 'Software y suscripciones', isFixed: true },
  { slug: 'seguros', name: 'Seguros y responsabilidad civil', isFixed: true },
  { slug: 'gestoria', name: 'Gestoría y asesoría', isFixed: true },
  { slug: 'material', name: 'Material sanitario y fungible', isFixed: false },
  { slug: 'marketing', name: 'Marketing y publicidad', isFixed: false },
  { slug: 'formacion', name: 'Formación', isFixed: false },
  { slug: 'mantenimiento', name: 'Mantenimiento y limpieza', isFixed: false },
  { slug: 'bancarios', name: 'Comisiones bancarias y TPV', isFixed: false },
  { slug: 'impuestos', name: 'Impuestos y tasas', isFixed: false },
  { slug: 'otros', name: 'Otros gastos', isFixed: false },
];

export const DEFAULT_INCOME_CATEGORIES: DefaultCategory[] = [
  { slug: 'bonos', name: 'Bonos y packs de sesiones', isFixed: false },
  { slug: 'productos', name: 'Venta de productos', isFixed: false },
  { slug: 'otros', name: 'Otros ingresos', isFixed: false },
];

/** "Gestoría y asesoría" → "gestoria-y-asesoria". Clave estable para no duplicar. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ─── Exportación ────────────────────────────────────────────────────────────

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV a la española (punto y coma, coma decimal) para la gestoría. */
export function ledgerToCsv(lines: LedgerLine[]): string {
  const header = [
    'Fecha',
    'Fecha de pago',
    'Tipo',
    'Concepto',
    'Categoría',
    'Proveedor / pagador',
    'Paciente',
    'Profesional',
    'Importe',
    'Estado',
    'Método',
    'Origen',
    'Notas',
  ];
  const rows = lines.map((l) =>
    [
      l.occurredOn,
      l.paidOn,
      FINANCE_KIND_LABELS[l.kind],
      l.concept,
      l.source === 'entry' ? l.categoryName : 'Sesiones',
      l.counterparty,
      l.patientName,
      l.professionalName,
      l.amountCents === null ? '' : (l.amountCents / 100).toFixed(2).replace('.', ','),
      FINANCE_STATUS_LABELS[l.status],
      l.paymentMethod ? FINANCE_PAYMENT_METHOD_LABELS[l.paymentMethod] : '',
      l.source === 'entry' ? 'Libro' : l.source === 'charge' ? 'Cobro de cita' : 'Sesión sin cobro',
      l.notes,
    ]
      .map(csvCell)
      .join(';'),
  );
  return `﻿${[header.join(';'), ...rows].join('\r\n')}`;
}
