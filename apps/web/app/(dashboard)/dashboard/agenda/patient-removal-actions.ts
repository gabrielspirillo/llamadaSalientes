'use server';

import { revalidatePath } from 'next/cache';

import { AgendaForbiddenError, requireAgendaManager } from '@/lib/agenda/auth';
import { recordAudit } from '@/lib/audit';
import { PatientValidationError } from '@/lib/patients/persons';
import {
  type RemovalPreview,
  mergePatientRecords,
  previewRemoval,
  removePatientEverywhere,
} from '@/lib/patients/removal';

/**
 * Quitar a un paciente o contacto de la lista, y unir fichas duplicadas.
 *
 * Sólo el administrador de la clínica (o Futura). Se puede quitar a
 * cualquiera, tenga o no historia: el diálogo enseña antes todo lo que se
 * borra y, si hay historia, pide escribir BORRAR. Las facturas emitidas no se
 * borran nunca (son documentos legales numerados).
 *
 * Va en un fichero aparte de `actions.ts` para no pisarse con quien esté
 * tocando ese archivo.
 */

export type { RemovalPreview };

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof AgendaForbiddenError || err instanceof PatientValidationError) {
    return { ok: false, error: err.message };
  }
  console.error('[patient-removal]', err);
  if (err instanceof Error && err.message) return { ok: false, error: err.message };
  return { ok: false, error: 'No se pudo completar la operación.' };
}

function revalidateLists() {
  revalidatePath('/dashboard/agenda/pacientes', 'layout');
  revalidatePath('/dashboard/agenda');
}

export async function patientRemovalPreviewAction(
  patientKey: string,
): Promise<Result<RemovalPreview>> {
  try {
    const ctx = await requireAgendaManager();
    const preview = await previewRemoval(ctx.tenantId, patientKey);
    if (!preview) return { ok: false, error: 'Ese paciente ya no existe. Recarga la página.' };
    return { ok: true, data: preview };
  } catch (err) {
    return fail(err);
  }
}

export async function removePatientAction(patientKey: string): Promise<Result<null>> {
  try {
    const ctx = await requireAgendaManager();
    const preview = await previewRemoval(ctx.tenantId, patientKey);
    await removePatientEverywhere({ tenantId: ctx.tenantId, userId: ctx.userId }, patientKey);
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'delete',
      entity: 'patient',
      entityId: null,
      before: preview,
      after: { patientKey },
    }).catch(() => undefined);
    revalidateLists();
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Une fichas duplicadas en la que eligió el usuario (`keepKey`, de cualquier
 * tipo). Devuelve la clave de la ficha resultante.
 */
export async function mergePatientsAction(
  keepKey: string,
  dropKeys: string[],
): Promise<Result<{ moved: number; patientKey: string }>> {
  try {
    const ctx = await requireAgendaManager();
    const result = await mergePatientRecords(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      keepKey,
      dropKeys,
    );
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'merge',
      entity: 'patient',
      entityId: null,
      after: {
        patientKey: result.patientKey,
        chosen: keepKey,
        merged: dropKeys,
        moved: result.moved,
      },
    }).catch(() => undefined);
    revalidateLists();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}
