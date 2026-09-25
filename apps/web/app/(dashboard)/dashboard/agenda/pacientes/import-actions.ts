'use server';

import { revalidatePath } from 'next/cache';

import { AgendaForbiddenError, requireAgendaManager } from '@/lib/agenda/auth';
import { recordAudit } from '@/lib/audit';
import { getCareProfile } from '@/lib/care-profile/queries';
import { ContactsImportError } from '@/lib/patients/import-contacts';
import {
  type ImportBatchResult,
  type ImportPreview,
  importContactsBatch,
  previewContactsImport,
} from '@/lib/patients/import-service';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** 5 MB de texto: un export de Google con 10.000 contactos ronda 1 MB. */
const MAX_CSV_CHARS = 5_000_000;

/**
 * Importar contactos es un alta masiva de fichas: sólo el administrador de la
 * clínica (o Futura), y sólo en clínicas con perfil de atención, que son las
 * que llevan al paciente como persona separada del teléfono del tutor.
 */
async function gate(csvText: string) {
  const ctx = await requireAgendaManager();
  const profile = await getCareProfile(ctx.tenantId);
  if (!profile) {
    throw new AgendaForbiddenError(
      'El importador de contactos no está disponible para esta clínica.',
    );
  }
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    throw new ContactsImportError('El archivo está vacío.');
  }
  if (csvText.length > MAX_CSV_CHARS) {
    throw new ContactsImportError('El archivo es demasiado grande (máximo 5 MB).');
  }
  return ctx;
}

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof ContactsImportError || err instanceof AgendaForbiddenError) {
    return { ok: false, error: err.message };
  }
  console.error('[import-contacts]', err);
  return { ok: false, error: 'No se pudo leer el archivo.' };
}

export async function previewContactsImportAction(csvText: string): Promise<Result<ImportPreview>> {
  try {
    const ctx = await gate(csvText);
    return { ok: true, data: await previewContactsImport(ctx.tenantId, csvText) };
  } catch (err) {
    return fail(err);
  }
}

export async function importContactsBatchAction(
  csvText: string,
  offset: number,
): Promise<Result<ImportBatchResult>> {
  try {
    const ctx = await gate(csvText);
    const result = await importContactsBatch(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      csvText,
      offset,
    );
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'create',
      entity: 'patient',
      entityId: null,
      after: {
        field: 'importacion_contactos',
        offset,
        created: result.created,
        skippedExisting: result.skippedExisting,
        errors: result.errors.length,
      },
    }).catch(() => undefined);
    if (result.nextOffset === null) {
      revalidatePath('/dashboard/agenda/pacientes');
      revalidatePath('/dashboard/agenda');
    }
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}
