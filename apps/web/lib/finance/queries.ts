import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { describeConcept, isChargeFileKind } from '@/lib/agenda/billing';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  financeCategories,
  financeEntries,
  financeEntryFiles,
  financeSettings,
  patientChargeFiles,
  patientCharges,
  professionals,
  treatments,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import {
  FINANCE_RECURRENCES,
  type FinanceKind,
  type FinanceRecurrence,
  type FinanceStatus,
  type LedgerFile,
  type LedgerLine,
  endOfMonthKey,
  isFinanceKind,
  isFinancePaymentMethod,
  isFinanceRecurrence,
  recurrenceSourceMonth,
} from '@/lib/finance/model';
import { mediaSignedUrl } from '@/lib/storage/media';

/**
 * Lecturas del módulo Finanzas.
 *
 * El libro es la unión de tres fuentes: el libro propio (`finance_entries`),
 * los cobros de las citas (`patient_charges`, que sigue escribiendo la ficha
 * del paciente) y las sesiones ya atendidas que no tienen cobro. Las tres se
 * normalizan a `LedgerLine` y de ahí en adelante todo es puro (`model.ts`).
 */

export interface FinanceCategoryRecord {
  id: string;
  kind: FinanceKind;
  slug: string;
  name: string;
  isFixed: boolean;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
}

export async function listFinanceCategories(
  tenantId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<FinanceCategoryRecord[]> {
  const where = [eq(financeCategories.tenantId, tenantId)];
  if (!opts.includeInactive) where.push(eq(financeCategories.active, true));
  const rows = await db
    .select()
    .from(financeCategories)
    .where(and(...where))
    .orderBy(
      asc(financeCategories.kind),
      asc(financeCategories.sortOrder),
      asc(financeCategories.name),
    );
  return rows
    .filter((r) => isFinanceKind(r.kind))
    .map((r) => ({
      id: r.id,
      kind: r.kind as FinanceKind,
      slug: r.slug,
      name: r.name,
      isFixed: r.isFixed,
      active: r.active,
      isSystem: r.isSystem,
      sortOrder: r.sortOrder,
    }));
}

export interface FinanceSettingsRecord {
  monthlyRevenueGoalCents: number | null;
}

export async function getFinanceSettings(tenantId: string): Promise<FinanceSettingsRecord> {
  const rows = await db
    .select({ goal: financeSettings.monthlyRevenueGoalCents })
    .from(financeSettings)
    .where(eq(financeSettings.tenantId, tenantId))
    .limit(1);
  return { monthlyRevenueGoalCents: rows[0]?.goal ?? null };
}

export interface FinanceProfessional {
  id: string;
  fullName: string;
  color: string;
  active: boolean;
}

/** Los profesionales, activos o no: un gasto de hace meses puede ser del que ya no está. */
export async function listFinanceProfessionals(tenantId: string): Promise<FinanceProfessional[]> {
  const rows = await db
    .select({
      id: professionals.id,
      fullName: professionals.fullName,
      color: professionals.color,
      active: professionals.active,
    })
    .from(professionals)
    .where(eq(professionals.tenantId, tenantId))
    .orderBy(desc(professionals.active), asc(professionals.fullName));
  return rows;
}

function toStatus(value: string): FinanceStatus {
  return value === 'PAID' ? 'PAID' : 'PENDING';
}

async function loadEntryFiles(
  tenantId: string,
  entryIds: string[],
): Promise<Map<string, LedgerFile[]>> {
  const map = new Map<string, LedgerFile[]>();
  if (entryIds.length === 0) return map;
  const rows = await db
    .select({
      id: financeEntryFiles.id,
      entryId: financeEntryFiles.entryId,
      name: financeEntryFiles.fileName,
      kind: financeEntryFiles.kind,
    })
    .from(financeEntryFiles)
    .where(
      and(eq(financeEntryFiles.tenantId, tenantId), inArray(financeEntryFiles.entryId, entryIds)),
    )
    .orderBy(asc(financeEntryFiles.createdAt));
  for (const f of rows) {
    const list = map.get(f.entryId) ?? [];
    list.push({ id: f.id, name: f.name, kind: isChargeFileKind(f.kind) ? f.kind : 'RECEIPT' });
    map.set(f.entryId, list);
  }
  return map;
}

async function loadChargeFiles(
  tenantId: string,
  chargeIds: string[],
): Promise<Map<string, LedgerFile[]>> {
  const map = new Map<string, LedgerFile[]>();
  if (chargeIds.length === 0) return map;
  const rows = await db
    .select({
      id: patientChargeFiles.id,
      chargeId: patientChargeFiles.chargeId,
      name: patientChargeFiles.fileName,
      kind: patientChargeFiles.kind,
    })
    .from(patientChargeFiles)
    .where(
      and(
        eq(patientChargeFiles.tenantId, tenantId),
        inArray(patientChargeFiles.chargeId, chargeIds),
      ),
    )
    .orderBy(asc(patientChargeFiles.createdAt));
  for (const f of rows) {
    const list = map.get(f.chargeId) ?? [];
    list.push({ id: f.id, name: f.name, kind: isChargeFileKind(f.kind) ? f.kind : 'RECEIPT' });
    map.set(f.chargeId, list);
  }
  return map;
}

export interface LedgerWindow {
  /** 'YYYY-MM-DD' inclusive. */
  from: string;
  to: string;
  /** Zona de la clínica: la fecha local de cada cita sale de aquí. */
  tz: string;
}

/**
 * Todo lo que toca la ventana [from, to] por devengo o por caja, MÁS lo
 * pendiente anterior a `to` (un saldo abierto lo es hasta que se cierra,
 * aunque el período elegido sea este mes). El período anterior de las
 * comparativas entra en la misma ventana: quien llama pasa `from` =
 * principio del tramo anterior y el modelo reparte.
 */
export async function loadFinanceLedger(tenantId: string, w: LedgerWindow): Promise<LedgerLine[]> {
  const [entries, charges, unbilled] = await Promise.all([
    loadEntries(tenantId, w),
    loadCharges(tenantId, w),
    loadUnbilledAppointments(tenantId, w),
  ]);
  return [...entries, ...charges, ...unbilled];
}

async function loadEntries(tenantId: string, w: LedgerWindow): Promise<LedgerLine[]> {
  const rows = await db
    .select({
      entry: financeEntries,
      categoryName: financeCategories.name,
      categoryFixed: financeCategories.isFixed,
      professionalName: professionals.fullName,
    })
    .from(financeEntries)
    .leftJoin(financeCategories, eq(financeCategories.id, financeEntries.categoryId))
    .leftJoin(professionals, eq(professionals.id, financeEntries.professionalId))
    .where(
      and(
        eq(financeEntries.tenantId, tenantId),
        or(
          sql`${financeEntries.occurredOn} between ${w.from} and ${w.to}`,
          sql`${financeEntries.paidOn} between ${w.from} and ${w.to}`,
          and(eq(financeEntries.status, 'PENDING'), lte(financeEntries.occurredOn, w.to)),
        ),
      ),
    )
    .orderBy(desc(financeEntries.occurredOn))
    .limit(5000);
  const files = await loadEntryFiles(
    tenantId,
    rows.map((r) => r.entry.id),
  );
  return rows
    .filter((r) => isFinanceKind(r.entry.kind))
    .map(({ entry, categoryName, categoryFixed, professionalName }) => ({
      key: `entry:${entry.id}`,
      source: 'entry' as const,
      sourceId: entry.id,
      kind: entry.kind as FinanceKind,
      concept: entry.concept,
      counterparty: entry.counterparty,
      categoryId: entry.categoryId,
      categoryName: categoryName ?? null,
      isFixed: entry.kind === 'EXPENSE' && Boolean(categoryFixed),
      amountCents: entry.amountCents,
      taxCents: entry.taxCents,
      status: toStatus(entry.status),
      occurredOn: entry.occurredOn,
      paidOn: entry.paidOn,
      paymentMethod: isFinancePaymentMethod(entry.paymentMethod) ? entry.paymentMethod : null,
      professionalId: entry.professionalId,
      professionalName: professionalName ?? null,
      treatmentName: null,
      patientKey: null,
      patientName: null,
      isRecurring: entry.isRecurring,
      recurrence: isFinanceRecurrence(entry.recurrence)
        ? entry.recurrence
        : entry.isRecurring
          ? 'MONTHLY'
          : null,
      notes: entry.notes,
      files: files.get(entry.id) ?? [],
    }));
}

/** La fecha local (zona de la clínica) de un instante, como 'YYYY-MM-DD'. */
function localDateSql(column: unknown, tz: string) {
  return sql<string>`to_char((${column} at time zone ${tz}), 'YYYY-MM-DD')`;
}

async function loadCharges(tenantId: string, w: LedgerWindow): Promise<LedgerLine[]> {
  // Devengo del cobro: el día de la cita; sin cita, el día en que se creó.
  const occurred = sql<string>`coalesce(${localDateSql(agendaAppointments.startsAt, w.tz)}, ${localDateSql(
    patientCharges.createdAt,
    w.tz,
  )})`;
  const rows = await db
    .select({
      charge: patientCharges,
      occurredOn: occurred,
      appointmentStatus: agendaAppointments.status,
      professionalId: agendaAppointments.professionalId,
      professionalName: professionals.fullName,
      treatmentName: treatments.name,
      patientName: agendaAppointments.patientName,
    })
    .from(patientCharges)
    .leftJoin(agendaAppointments, eq(agendaAppointments.id, patientCharges.appointmentId))
    .leftJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .where(
      and(
        eq(patientCharges.tenantId, tenantId),
        or(
          sql`${patientCharges.paidOn} between ${w.from} and ${w.to}`,
          sql`${occurred} between ${w.from} and ${w.to}`,
          and(eq(patientCharges.status, 'PENDING'), sql`${occurred} <= ${w.to}`),
        ),
      ),
    )
    .orderBy(desc(patientCharges.createdAt))
    .limit(5000);
  const files = await loadChargeFiles(
    tenantId,
    rows.map((r) => r.charge.id),
  );
  return rows.map((r) => ({
    key: `charge:${r.charge.id}`,
    source: 'charge' as const,
    sourceId: r.charge.id,
    kind: 'INCOME' as const,
    concept: r.charge.concept,
    counterparty: null,
    categoryId: null,
    categoryName: 'Sesiones',
    isFixed: false,
    amountCents: r.charge.amountCents,
    taxCents: 0,
    status: toStatus(r.charge.status),
    occurredOn: r.occurredOn,
    paidOn: r.charge.paidOn,
    paymentMethod: isFinancePaymentMethod(r.charge.paymentMethod) ? r.charge.paymentMethod : null,
    professionalId: r.professionalId ?? null,
    professionalName: r.professionalName ?? null,
    treatmentName: r.treatmentName ?? null,
    patientKey: r.charge.patientKey,
    patientName: r.patientName ?? null,
    isRecurring: false,
    recurrence: null,
    notes: null,
    files: files.get(r.charge.id) ?? [],
  }));
}

/**
 * Sesiones ya atendidas (o al menos pasadas y no anuladas) sin ningún cargo:
 * la fuga de cobro. Salen PENDIENTES con el precio del tratamiento, igual
 * que en la pestaña Contable de la ficha, para que el dueño las vea y las
 * cobre desde allí.
 */
async function loadUnbilledAppointments(tenantId: string, w: LedgerWindow): Promise<LedgerLine[]> {
  const localDate = localDateSql(agendaAppointments.startsAt, w.tz);
  const rows = await db
    .select({
      id: agendaAppointments.id,
      occurredOn: localDate,
      professionalId: agendaAppointments.professionalId,
      professionalName: professionals.fullName,
      treatmentName: treatments.name,
      treatmentPriceCents: treatments.priceCents,
      isFirstVisit: agendaAppointments.isFirstVisit,
      patientKey: agendaAppointments.patientKey,
      patientName: agendaAppointments.patientName,
    })
    .from(agendaAppointments)
    .innerJoin(professionals, eq(professionals.id, agendaAppointments.professionalId))
    .leftJoin(treatments, eq(treatments.id, agendaAppointments.treatmentId))
    .leftJoin(
      patientCharges,
      and(
        eq(patientCharges.appointmentId, agendaAppointments.id),
        eq(patientCharges.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(agendaAppointments.tenantId, tenantId),
        isNull(patientCharges.id),
        notInArray(agendaAppointments.status, ['CANCELLED', 'NO_SHOW']),
        sql`${agendaAppointments.startsAt} < now()`,
        sql`${localDate} <= ${w.to}`,
      ),
    )
    .orderBy(desc(agendaAppointments.startsAt))
    .limit(2000);
  return rows.map((r) => ({
    key: `appointment:${r.id}`,
    source: 'appointment' as const,
    sourceId: r.id,
    kind: 'INCOME' as const,
    concept: describeConcept({
      treatmentName: r.treatmentName ?? null,
      professionalName: r.professionalName,
      isFirstVisit: r.isFirstVisit,
    }),
    counterparty: null,
    categoryId: null,
    categoryName: 'Sesiones',
    isFixed: false,
    amountCents: r.treatmentPriceCents ?? null,
    taxCents: 0,
    status: 'PENDING' as const,
    occurredOn: r.occurredOn,
    paidOn: null,
    paymentMethod: null,
    professionalId: r.professionalId,
    professionalName: r.professionalName,
    treatmentName: r.treatmentName ?? null,
    patientKey: r.patientKey,
    patientName: r.patientName,
    isRecurring: false,
    recurrence: null,
    notes: null,
    files: [],
  }));
}

/** Un movimiento del libro propio, para editarlo. Null si no es de esta clínica. */
export async function getFinanceEntry(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db
    .select()
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * URL firmada (10 min) de un comprobante del libro. Se busca por (clínica de
 * la sesión, id): un id de otra clínica es un null, no un archivo ajeno.
 */
export async function financeFileSignedUrl(
  tenantId: string,
  fileId: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const rows = await db
    .select({ key: financeEntryFiles.storageKey })
    .from(financeEntryFiles)
    .where(and(eq(financeEntryFiles.tenantId, tenantId), eq(financeEntryFiles.id, fileId)))
    .limit(1);
  const key = rows[0]?.key;
  if (!key) return null;
  return mediaSignedUrl(key, { bucket: env.S3_BUCKET_INTERNAL, expiresInSeconds: 60 * 10 });
}

// ─── Ayudas para el alta y los ajustes ──────────────────────────────────────

export interface CounterpartySuggestion {
  name: string;
  kind: FinanceKind;
  /** La categoría con la que se usó la última vez, para rellenarla sola. */
  categoryId: string | null;
}

/** Proveedores y pagadores ya usados, el más reciente primero, sin repetir. */
export async function listCounterparties(tenantId: string): Promise<CounterpartySuggestion[]> {
  const rows = await db
    .select({
      name: financeEntries.counterparty,
      kind: financeEntries.kind,
      categoryId: financeEntries.categoryId,
    })
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), isNotNull(financeEntries.counterparty)))
    .orderBy(desc(financeEntries.createdAt))
    .limit(500);
  const seen = new Set<string>();
  const out: CounterpartySuggestion[] = [];
  for (const r of rows) {
    const name = r.name?.trim();
    if (!name || !isFinanceKind(r.kind)) continue;
    const key = `${r.kind}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind: r.kind, categoryId: r.categoryId });
  }
  return out;
}

/** Cuántos movimientos tiene cada categoría (para Ajustes). */
export async function countEntriesByCategory(tenantId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({ categoryId: financeEntries.categoryId, count: sql<number>`count(*)::int` })
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), isNotNull(financeEntries.categoryId)))
    .groupBy(financeEntries.categoryId);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.categoryId) out[r.categoryId] = r.count;
  return out;
}

/**
 * Los recurrentes que tocan en `monthKey` y todavía no se han traído: los
 * mensuales del mes anterior, los trimestrales de hace tres meses, los
 * anuales de hace doce. Es lo que decide si el botón se enseña y cuántos dice.
 */
export async function countRecurringCandidates(
  tenantId: string,
  monthKey: string,
): Promise<{ candidates: number; alreadyCopied: number }> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return { candidates: 0, alreadyCopied: 0 };
  const conditions = FINANCE_RECURRENCES.map((rec: FinanceRecurrence) => {
    const from = `${recurrenceSourceMonth(monthKey, rec)}-01`;
    const to = endOfMonthKey(from);
    const byRecurrence =
      rec === 'MONTHLY'
        ? or(
            eq(financeEntries.recurrence, rec),
            and(isNull(financeEntries.recurrence), eq(financeEntries.isRecurring, true)),
          )
        : eq(financeEntries.recurrence, rec);
    return and(
      byRecurrence,
      gte(financeEntries.occurredOn, from),
      lte(financeEntries.occurredOn, to),
    );
  });
  const sources = await db
    .select({ id: financeEntries.id, dedupeKey: financeEntries.dedupeKey })
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), or(...conditions)));
  if (sources.length === 0) return { candidates: 0, alreadyCopied: 0 };
  const existing = await db
    .select({ dedupeKey: financeEntries.dedupeKey })
    .from(financeEntries)
    .where(
      and(
        eq(financeEntries.tenantId, tenantId),
        sql`${financeEntries.dedupeKey} like ${`rec:%:${monthKey}`}`,
      ),
    );
  const copied = new Set(existing.map((e) => e.dedupeKey));
  let candidates = 0;
  let alreadyCopied = 0;
  for (const src of sources) {
    const root = /^rec:([^:]+):/.exec(src.dedupeKey ?? '')?.[1] ?? src.id;
    if (copied.has(`rec:${root}:${monthKey}`)) alreadyCopied += 1;
    else candidates += 1;
  }
  return { candidates, alreadyCopied };
}
