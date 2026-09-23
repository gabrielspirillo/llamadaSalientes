import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';

import type { ChargeFileKind } from '@/lib/agenda/billing';
import { db } from '@/lib/db/client';
import {
  financeCategories,
  financeEntries,
  financeEntryFiles,
  financeSettings,
  professionals,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  FINANCE_RECURRENCES,
  type FinanceKind,
  type FinancePaymentMethod,
  type FinanceRecurrence,
  type FinanceStatus,
  daysInMonth,
  endOfMonthKey,
  isDateKey,
  isFinanceKind,
  isFinancePaymentMethod,
  isFinanceRecurrence,
  isFinanceStatus,
  recurrenceSourceMonth,
  slugify,
} from '@/lib/finance/model';
import { mediaDelete, mediaUpload } from '@/lib/storage/media';
import { parseDateKey } from '@/lib/tasks/tz';

/**
 * Escrituras del módulo Finanzas. Todas validan antes de tocar la base y
 * todas llevan `tenant_id` en el WHERE, también cuando el id ya vino de una
 * fila validada.
 */

export class FinanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceValidationError';
  }
}

export interface FinanceScope {
  tenantId: string;
  userId: string | null;
}

// ─── Provisión ──────────────────────────────────────────────────────────────

/**
 * Siembra las categorías por defecto la primera vez que la clínica abre el
 * módulo. Idempotente: el único parcial por (clínica, tipo, slug) hace que
 * volver a correrlo no cree nada.
 */
export async function ensureFinanceProvisioned(tenantId: string): Promise<{ seeded: number }> {
  const existing = await db
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(eq(financeCategories.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) return { seeded: 0 };

  const values = [
    ...DEFAULT_EXPENSE_CATEGORIES.map((c, i) => ({ ...c, kind: 'EXPENSE' as const, sortOrder: i })),
    ...DEFAULT_INCOME_CATEGORIES.map((c, i) => ({ ...c, kind: 'INCOME' as const, sortOrder: i })),
  ];
  const inserted = await db
    .insert(financeCategories)
    .values(
      values.map((c) => ({
        tenantId,
        kind: c.kind,
        slug: c.slug,
        name: c.name,
        isFixed: c.isFixed,
        sortOrder: c.sortOrder,
        isSystem: true,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: financeCategories.id });
  return { seeded: inserted.length };
}

// ─── Movimientos ────────────────────────────────────────────────────────────

export interface EntryInput {
  kind: FinanceKind;
  concept: string;
  categoryId?: string | null;
  counterparty?: string | null;
  amountCents: number;
  taxCents?: number | null;
  /** 'YYYY-MM-DD' */
  occurredOn: string;
  status: FinanceStatus;
  /** 'YYYY-MM-DD'. Con estado PAGADO y sin fecha, se toma la del movimiento. */
  paidOn?: string | null;
  paymentMethod?: FinancePaymentMethod | null;
  professionalId?: string | null;
  /** Cada cuánto se repite. Null = no se repite. */
  recurrence?: FinanceRecurrence | null;
  notes?: string | null;
}

interface NormalizedEntry {
  kind: FinanceKind;
  concept: string;
  categoryId: string | null;
  counterparty: string | null;
  amountCents: number;
  taxCents: number;
  occurredOn: string;
  status: FinanceStatus;
  paidOn: string | null;
  paymentMethod: FinancePaymentMethod | null;
  professionalId: string | null;
  isRecurring: boolean;
  recurrence: FinanceRecurrence | null;
  notes: string | null;
}

function clean(value: string | null | undefined, max: number): string | null {
  const v = value?.trim() ?? '';
  return v ? v.slice(0, max) : null;
}

/** Comprueba coherencia y normaliza. Lo que toca la base (categoría, profesional) va aparte. */
export function normalizeEntryInput(input: EntryInput): NormalizedEntry {
  if (!isFinanceKind(input.kind))
    throw new FinanceValidationError('Elige si es un gasto o un ingreso.');
  const concept = clean(input.concept, 200);
  if (!concept) throw new FinanceValidationError('Escribe el concepto.');
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new FinanceValidationError('El importe no es válido.');
  }
  const taxCents = input.taxCents ?? 0;
  if (!Number.isInteger(taxCents) || taxCents < 0 || taxCents > input.amountCents) {
    throw new FinanceValidationError('El IVA no puede superar el importe.');
  }
  if (!isDateKey(input.occurredOn)) throw new FinanceValidationError('La fecha no es válida.');
  if (!isFinanceStatus(input.status))
    throw new FinanceValidationError('Elige si está pagado o pendiente.');
  let paidOn: string | null = null;
  let paymentMethod: FinancePaymentMethod | null = null;
  if (input.status === 'PAID') {
    paidOn = input.paidOn && isDateKey(input.paidOn) ? input.paidOn : input.occurredOn;
    if (input.paidOn && !isDateKey(input.paidOn)) {
      throw new FinanceValidationError('La fecha de pago no es válida.');
    }
    if (input.paymentMethod !== null && input.paymentMethod !== undefined) {
      if (!isFinancePaymentMethod(input.paymentMethod)) {
        throw new FinanceValidationError('El método de pago no es válido.');
      }
      paymentMethod = input.paymentMethod;
    }
  }
  const recurrence = input.recurrence ?? null;
  if (recurrence !== null && !isFinanceRecurrence(recurrence)) {
    throw new FinanceValidationError('La recurrencia no es válida.');
  }
  return {
    kind: input.kind,
    concept,
    categoryId: clean(input.categoryId, 36),
    counterparty: clean(input.counterparty, 200),
    amountCents: input.amountCents,
    taxCents,
    occurredOn: input.occurredOn,
    status: input.status,
    paidOn,
    paymentMethod,
    professionalId: clean(input.professionalId, 36),
    isRecurring: recurrence !== null,
    recurrence,
    notes: clean(input.notes, 2000),
  };
}

async function assertCategory(tenantId: string, categoryId: string | null, kind: FinanceKind) {
  if (!categoryId) return;
  if (!/^[0-9a-f-]{36}$/i.test(categoryId))
    throw new FinanceValidationError('Esa categoría no existe.');
  const rows = await db
    .select({ id: financeCategories.id, kind: financeCategories.kind })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, tenantId), eq(financeCategories.id, categoryId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new FinanceValidationError('Esa categoría no existe en esta clínica.');
  if (row.kind !== kind) {
    throw new FinanceValidationError(
      kind === 'EXPENSE' ? 'Esa categoría es de ingresos.' : 'Esa categoría es de gastos.',
    );
  }
}

async function assertProfessional(tenantId: string, professionalId: string | null) {
  if (!professionalId) return;
  if (!/^[0-9a-f-]{36}$/i.test(professionalId)) {
    throw new FinanceValidationError('Ese profesional no existe.');
  }
  const rows = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(and(eq(professionals.tenantId, tenantId), eq(professionals.id, professionalId)))
    .limit(1);
  if (!rows[0]) throw new FinanceValidationError('Ese profesional no existe en esta clínica.');
}

async function findEntry(tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await db
    .select()
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, tenantId), eq(financeEntries.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createEntry(scope: FinanceScope, input: EntryInput): Promise<{ id: string }> {
  const n = normalizeEntryInput(input);
  await assertCategory(scope.tenantId, n.categoryId, n.kind);
  await assertProfessional(scope.tenantId, n.professionalId);
  const [row] = await db
    .insert(financeEntries)
    .values({ tenantId: scope.tenantId, ...n, createdByUserId: scope.userId })
    .returning({ id: financeEntries.id });
  if (!row) throw new FinanceValidationError('No se pudo guardar el movimiento.');
  return { id: row.id };
}

export async function updateEntry(
  scope: FinanceScope,
  id: string,
  input: EntryInput,
): Promise<{ id: string; before: typeof financeEntries.$inferSelect }> {
  const before = await findEntry(scope.tenantId, id);
  if (!before) throw new FinanceValidationError('Ese movimiento ya no existe.');
  const n = normalizeEntryInput(input);
  await assertCategory(scope.tenantId, n.categoryId, n.kind);
  await assertProfessional(scope.tenantId, n.professionalId);
  await db
    .update(financeEntries)
    .set({ ...n, updatedAt: new Date() })
    .where(and(eq(financeEntries.tenantId, scope.tenantId), eq(financeEntries.id, before.id)));
  return { id: before.id, before };
}

/** Un pendiente pasa a pagado con fecha y método. Sobre uno pagado corrige los dos datos. */
export async function markEntryPaid(
  scope: FinanceScope,
  id: string,
  input: { paidOn: string; paymentMethod: FinancePaymentMethod | null },
): Promise<{ id: string }> {
  const entry = await findEntry(scope.tenantId, id);
  if (!entry) throw new FinanceValidationError('Ese movimiento ya no existe.');
  if (!isDateKey(input.paidOn)) throw new FinanceValidationError('La fecha de pago no es válida.');
  if (input.paymentMethod !== null && !isFinancePaymentMethod(input.paymentMethod)) {
    throw new FinanceValidationError('El método de pago no es válido.');
  }
  await db
    .update(financeEntries)
    .set({
      status: 'PAID',
      paidOn: input.paidOn,
      paymentMethod: input.paymentMethod,
      updatedAt: new Date(),
    })
    .where(and(eq(financeEntries.tenantId, scope.tenantId), eq(financeEntries.id, entry.id)));
  return { id: entry.id };
}

/** Borra el movimiento y sus comprobantes del bucket. Devuelve la fila para el audit. */
export async function deleteEntry(
  scope: FinanceScope,
  id: string,
): Promise<{ before: typeof financeEntries.$inferSelect }> {
  const before = await findEntry(scope.tenantId, id);
  if (!before) throw new FinanceValidationError('Ese movimiento ya no existe.');
  const files = await db
    .select({ key: financeEntryFiles.storageKey })
    .from(financeEntryFiles)
    .where(
      and(eq(financeEntryFiles.tenantId, scope.tenantId), eq(financeEntryFiles.entryId, before.id)),
    );
  await db
    .delete(financeEntries)
    .where(and(eq(financeEntries.tenantId, scope.tenantId), eq(financeEntries.id, before.id)));
  // Best-effort: un objeto que no se pudo borrar no resucita el movimiento.
  await Promise.all(
    files.map((f) => mediaDelete(f.key, { bucket: env.S3_BUCKET_INTERNAL }).catch(() => undefined)),
  );
  return { before };
}

/**
 * Trae al mes `monthKey` los recurrentes que tocan y todavía no están: los
 * mensuales del mes anterior, los trimestrales de hace tres meses, los
 * anuales de hace doce. Cada copia nace PENDIENTE con el mismo día (o el
 * último del mes si no existe) y lleva `dedupe_key` 'rec:<raíz>:<mes>', así
 * que volver a pulsar no duplica nada.
 */
export async function replicateRecurring(
  scope: FinanceScope,
  monthKey: string,
): Promise<{ created: number; skipped: number }> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new FinanceValidationError('El mes no es válido.');
  const target = parseDateKey(`${monthKey}-01`);
  if (!target) throw new FinanceValidationError('El mes no es válido.');
  const lastDay = daysInMonth(target.year, target.month);

  const conditions = FINANCE_RECURRENCES.map((rec) => {
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
    .select()
    .from(financeEntries)
    .where(and(eq(financeEntries.tenantId, scope.tenantId), or(...conditions)));
  if (sources.length === 0) return { created: 0, skipped: 0 };

  let created = 0;
  let skipped = 0;
  for (const src of sources) {
    const rootMatch = /^rec:([^:]+):/.exec(src.dedupeKey ?? '');
    const rootId = rootMatch?.[1] ?? src.id;
    const day = Math.min(parseDateKey(src.occurredOn)?.day ?? 1, lastDay);
    const occurredOn = `${monthKey}-${String(day).padStart(2, '0')}`;
    const [row] = await db
      .insert(financeEntries)
      .values({
        tenantId: scope.tenantId,
        kind: src.kind,
        categoryId: src.categoryId,
        concept: src.concept,
        counterparty: src.counterparty,
        amountCents: src.amountCents,
        taxCents: src.taxCents,
        currency: src.currency,
        occurredOn,
        status: 'PENDING',
        paidOn: null,
        paymentMethod: src.paymentMethod,
        professionalId: src.professionalId,
        isRecurring: true,
        recurrence: isFinanceRecurrence(src.recurrence) ? src.recurrence : 'MONTHLY',
        dedupeKey: `rec:${rootId}:${monthKey}`,
        notes: src.notes,
        createdByUserId: scope.userId,
      })
      .onConflictDoNothing()
      .returning({ id: financeEntries.id });
    if (row) created += 1;
    else skipped += 1;
  }
  return { created, skipped };
}

// ─── Comprobantes ───────────────────────────────────────────────────────────

/** Extensión segura para la key del bucket. */
function extensionFor(fileName: string, mime: string): string {
  const fromName = fileName
    .split('.')
    .pop()
    ?.replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
  if (fromName && fromName.length <= 5 && fromName !== fileName.toLowerCase()) return fromName;
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic';
  return 'jpg';
}

/** Sube el comprobante al bucket interno y lo cuelga del movimiento. */
export async function attachEntryFile(
  scope: FinanceScope,
  input: {
    entryId: string;
    kind: ChargeFileKind;
    fileName: string;
    mimeType: string;
    body: Buffer;
  },
): Promise<{ id: string }> {
  const entry = await findEntry(scope.tenantId, input.entryId);
  if (!entry) throw new FinanceValidationError('Ese movimiento ya no existe.');

  const key = `tenants/${scope.tenantId}/finance/${entry.id}/${randomUUID()}.${extensionFor(
    input.fileName,
    input.mimeType,
  )}`;
  await mediaUpload({
    bucket: env.S3_BUCKET_INTERNAL,
    path: key,
    body: input.body,
    contentType: input.mimeType,
  });
  const [row] = await db
    .insert(financeEntryFiles)
    .values({
      tenantId: scope.tenantId,
      entryId: entry.id,
      kind: input.kind,
      fileName: input.fileName.slice(0, 200),
      storageKey: key,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      uploadedByUserId: scope.userId,
    })
    .returning({ id: financeEntryFiles.id });
  if (!row) throw new FinanceValidationError('No se pudo guardar el comprobante.');
  return { id: row.id };
}

export async function deleteEntryFile(
  scope: FinanceScope,
  fileId: string,
): Promise<{ entryId: string; fileName: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new FinanceValidationError('Ese archivo no existe.');
  const rows = await db
    .select()
    .from(financeEntryFiles)
    .where(and(eq(financeEntryFiles.tenantId, scope.tenantId), eq(financeEntryFiles.id, fileId)))
    .limit(1);
  const file = rows[0];
  if (!file) throw new FinanceValidationError('Ese archivo ya no existe.');
  await db
    .delete(financeEntryFiles)
    .where(and(eq(financeEntryFiles.tenantId, scope.tenantId), eq(financeEntryFiles.id, file.id)));
  await mediaDelete(file.storageKey, { bucket: env.S3_BUCKET_INTERNAL }).catch(() => undefined);
  return { entryId: file.entryId, fileName: file.fileName };
}

// ─── Categorías ─────────────────────────────────────────────────────────────

export async function createCategory(
  scope: FinanceScope,
  input: { kind: FinanceKind; name: string; isFixed: boolean },
): Promise<{ id: string }> {
  if (!isFinanceKind(input.kind)) throw new FinanceValidationError('Elige gasto o ingreso.');
  const name = clean(input.name, 80);
  if (!name) throw new FinanceValidationError('Escribe el nombre de la categoría.');
  const slug = slugify(name);
  if (!slug) throw new FinanceValidationError('El nombre no sirve como categoría.');
  const [row] = await db
    .insert(financeCategories)
    .values({
      tenantId: scope.tenantId,
      kind: input.kind,
      slug,
      name,
      isFixed: input.kind === 'EXPENSE' && Boolean(input.isFixed),
      sortOrder: 100,
    })
    .onConflictDoNothing()
    .returning({ id: financeCategories.id });
  if (!row) throw new FinanceValidationError('Ya hay una categoría con ese nombre.');
  return { id: row.id };
}

export async function updateCategory(
  scope: FinanceScope,
  id: string,
  input: { name?: string; isFixed?: boolean; active?: boolean },
): Promise<{ id: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new FinanceValidationError('Esa categoría no existe.');
  const rows = await db
    .select()
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, scope.tenantId), eq(financeCategories.id, id)))
    .limit(1);
  const cat = rows[0];
  if (!cat) throw new FinanceValidationError('Esa categoría no existe en esta clínica.');
  const patch: Partial<typeof financeCategories.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = clean(input.name, 80);
    if (!name) throw new FinanceValidationError('Escribe el nombre de la categoría.');
    patch.name = name;
  }
  if (input.isFixed !== undefined) patch.isFixed = cat.kind === 'EXPENSE' && Boolean(input.isFixed);
  if (input.active !== undefined) patch.active = Boolean(input.active);
  await db
    .update(financeCategories)
    .set(patch)
    .where(and(eq(financeCategories.tenantId, scope.tenantId), eq(financeCategories.id, cat.id)));
  return { id: cat.id };
}

/**
 * Nuevo orden de las categorías de un tipo: la posición en `orderedIds` pasa a
 * ser `sort_order`. Los ids que no sean de esta clínica se ignoran.
 */
export async function reorderCategories(
  scope: FinanceScope,
  kind: FinanceKind,
  orderedIds: string[],
): Promise<void> {
  if (!isFinanceKind(kind)) throw new FinanceValidationError('Tipo de categoría no válido.');
  const own = await db
    .select({ id: financeCategories.id })
    .from(financeCategories)
    .where(and(eq(financeCategories.tenantId, scope.tenantId), eq(financeCategories.kind, kind)));
  const allowed = new Set(own.map((c) => c.id));
  let position = 0;
  for (const id of orderedIds) {
    if (!allowed.has(id)) continue;
    await db
      .update(financeCategories)
      .set({ sortOrder: position, updatedAt: new Date() })
      .where(and(eq(financeCategories.tenantId, scope.tenantId), eq(financeCategories.id, id)));
    position += 1;
  }
}

// ─── Ajustes ────────────────────────────────────────────────────────────────

export async function saveFinanceSettings(
  scope: FinanceScope,
  input: { monthlyRevenueGoalCents: number | null },
): Promise<void> {
  const goal = input.monthlyRevenueGoalCents;
  if (goal !== null && (!Number.isInteger(goal) || goal < 0)) {
    throw new FinanceValidationError('El objetivo no es válido.');
  }
  await db
    .insert(financeSettings)
    .values({ tenantId: scope.tenantId, monthlyRevenueGoalCents: goal })
    .onConflictDoUpdate({
      target: financeSettings.tenantId,
      set: { monthlyRevenueGoalCents: goal, updatedAt: new Date() },
    });
}
