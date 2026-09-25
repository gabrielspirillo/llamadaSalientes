'use server';

import { revalidatePath } from 'next/cache';

import { parseAmountToCents } from '@/lib/agenda/billing';
import { recordAudit } from '@/lib/audit';
import {
  FinanceForbiddenError,
  requireFinanceManager,
  requireFinanceWriter,
} from '@/lib/finance/auth';
import type {
  FinanceKind,
  FinancePaymentMethod,
  FinanceRecurrence,
  FinanceStatus,
} from '@/lib/finance/model';
import {
  FinanceValidationError,
  createCategory,
  createEntry,
  deleteEntry,
  deleteEntryFile,
  markEntryPaid,
  reorderCategories,
  replicateRecurring,
  saveFinanceSettings,
  updateCategory,
  updateEntry,
} from '@/lib/finance/service';
import { InvoiceValidationError } from '@/lib/invoices/model';
import { type InvoiceSettingsInput, saveInvoiceSettings } from '@/lib/invoices/service';

export type FinanceActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (
    err instanceof FinanceValidationError ||
    err instanceof FinanceForbiddenError ||
    err instanceof InvoiceValidationError
  ) {
    return { ok: false, error: err.message };
  }
  console.error('[finanzas] acción fallida', err);
  return { ok: false, error: 'No se pudo completar la operación. Inténtalo de nuevo.' };
}

function revalidate() {
  revalidatePath('/dashboard/finanzas');
}

/** Lo que teclea quien carga el movimiento: importes como texto ("45,50"). */
export interface EntryFormInput {
  kind: FinanceKind;
  concept: string;
  categoryId?: string | null;
  counterparty?: string | null;
  amount: string;
  tax?: string | null;
  occurredOn: string;
  status: FinanceStatus;
  paidOn?: string | null;
  paymentMethod?: FinancePaymentMethod | null;
  professionalId?: string | null;
  recurrence?: FinanceRecurrence | null;
  notes?: string | null;
}

function toServiceInput(input: EntryFormInput) {
  const amountCents = parseAmountToCents(input.amount);
  if (amountCents === null)
    throw new FinanceValidationError('Escribe el importe, por ejemplo 45 o 45,50.');
  const taxRaw = input.tax?.trim() ?? '';
  const taxCents = taxRaw ? parseAmountToCents(taxRaw) : 0;
  if (taxCents === null) throw new FinanceValidationError('El IVA no es válido.');
  return {
    kind: input.kind,
    concept: input.concept,
    categoryId: input.categoryId ?? null,
    counterparty: input.counterparty ?? null,
    amountCents,
    taxCents,
    occurredOn: input.occurredOn,
    status: input.status,
    paidOn: input.paidOn ?? null,
    paymentMethod: input.paymentMethod ?? null,
    professionalId: input.professionalId ?? null,
    recurrence: input.recurrence ?? null,
    notes: input.notes ?? null,
  };
}

export async function createEntryAction(
  input: EntryFormInput,
): Promise<FinanceActionResult<{ id: string }>> {
  try {
    const ctx = await requireFinanceWriter();
    const data = toServiceInput(input);
    const { id } = await createEntry({ tenantId: ctx.tenantId, userId: ctx.userId }, data);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'create',
      entity: 'finance_entry',
      entityId: id,
      after: data,
    });
    revalidate();
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateEntryAction(
  id: string,
  input: EntryFormInput,
): Promise<FinanceActionResult<{ id: string }>> {
  try {
    const ctx = await requireFinanceWriter();
    const data = toServiceInput(input);
    const result = await updateEntry({ tenantId: ctx.tenantId, userId: ctx.userId }, id, data);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_entry',
      entityId: result.id,
      before: result.before,
      after: data,
    });
    revalidate();
    return { ok: true, data: { id: result.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function markEntryPaidAction(
  id: string,
  input: { paidOn: string; paymentMethod: FinancePaymentMethod | null },
): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceWriter();
    await markEntryPaid({ tenantId: ctx.tenantId, userId: ctx.userId }, id, input);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_entry',
      entityId: id,
      after: { status: 'PAID', ...input },
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Borrar es de administrador: un movimiento borrado desaparece de las cuentas. */
export async function deleteEntryAction(id: string): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    const { before } = await deleteEntry({ tenantId: ctx.tenantId, userId: ctx.userId }, id);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'delete',
      entity: 'finance_entry',
      entityId: id,
      before,
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteEntryFileAction(fileId: string): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    const result = await deleteEntryFile({ tenantId: ctx.tenantId, userId: ctx.userId }, fileId);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_entry',
      entityId: result.entryId,
      after: { removedFile: result.fileName },
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** "Traer los gastos fijos del mes pasado": copia los recurrentes que falten en `monthKey`. */
export async function replicateRecurringAction(
  monthKey: string,
): Promise<FinanceActionResult<{ created: number; skipped: number }>> {
  try {
    const ctx = await requireFinanceWriter();
    const result = await replicateRecurring(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      monthKey,
    );
    if (result.created > 0) {
      await recordAudit({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: 'create',
        entity: 'finance_entry',
        after: { replicated: result.created, monthKey },
      });
    }
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

export async function createCategoryAction(input: {
  kind: FinanceKind;
  name: string;
  isFixed: boolean;
}): Promise<FinanceActionResult<{ id: string }>> {
  try {
    const ctx = await requireFinanceManager();
    const { id } = await createCategory({ tenantId: ctx.tenantId, userId: ctx.userId }, input);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'create',
      entity: 'finance_category',
      entityId: id,
      after: input,
    });
    revalidate();
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateCategoryAction(
  id: string,
  input: { name?: string; isFixed?: boolean; active?: boolean },
): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    await updateCategory({ tenantId: ctx.tenantId, userId: ctx.userId }, id, input);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_category',
      entityId: id,
      after: input,
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reorderCategoriesAction(
  kind: FinanceKind,
  orderedIds: string[],
): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    await reorderCategories({ tenantId: ctx.tenantId, userId: ctx.userId }, kind, orderedIds);
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveFinanceSettingsAction(input: {
  /** "3.000" o vacío para quitar el objetivo. */
  monthlyRevenueGoal: string;
}): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    const raw = input.monthlyRevenueGoal.trim();
    const goal = raw ? parseAmountToCents(raw) : null;
    if (raw && goal === null) return { ok: false, error: 'El objetivo no es un importe válido.' };
    await saveFinanceSettings(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      { monthlyRevenueGoalCents: goal },
    );
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_settings',
      entityId: ctx.tenantId,
      after: { monthlyRevenueGoalCents: goal },
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Los datos del emisor de las facturas y el contador de la serie. Sólo admin. */
export async function saveInvoiceSettingsAction(
  input: InvoiceSettingsInput,
): Promise<FinanceActionResult> {
  try {
    const ctx = await requireFinanceManager();
    await saveInvoiceSettings({ tenantId: ctx.tenantId, userId: ctx.userId }, input);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'invoice_settings',
      entityId: ctx.tenantId,
      after: { ...input },
    });
    revalidate();
    revalidatePath('/dashboard/agenda', 'layout');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
