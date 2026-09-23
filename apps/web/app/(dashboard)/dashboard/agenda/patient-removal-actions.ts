'use server';

import { revalidatePath } from 'next/cache';

import { AgendaForbiddenError, requireAgendaManager } from '@/lib/agenda/auth';
import { patientIdFromKey, phoneFromPatientKey } from '@/lib/agenda/patients';
import {
  PatientValidationError,
  deletePatient,
  previewPatientDeletion,
} from '@/lib/patients/persons';
import { deleteContact, findPatientByPhone, previewContactDeletion } from '@/lib/patients/registry';

/**
 * Quitar de la lista a un paciente o contacto SIN historia.
 *
 * Existe por las pruebas del asistente: se ejecutan con tools reales sobre la
 * clínica que se está gestionando y dejan contactos que no existen. Sólo el
 * administrador (o Futura) puede, y sólo cuando no hay citas ni notas: con
 * historia no se borra nada desde aquí.
 *
 * Va en un fichero aparte de `actions.ts` para no pisarse con quien esté
 * tocando ese archivo.
 */

export type RemovalPreview = {
  kind: 'PATIENT' | 'CONTACT';
  name: string;
  appointments: number;
  notes: number;
  /** Lo que además se llevaría (mensajes de WhatsApp, niños a cargo). */
  warning: string | null;
  canDelete: boolean;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof AgendaForbiddenError || err instanceof PatientValidationError) {
    return { ok: false, error: err.message };
  }
  if (err instanceof Error && err.message) return { ok: false, error: err.message };
  return { ok: false, error: 'No se pudo completar la operación.' };
}

async function resolveTarget(
  tenantId: string,
  patientKey: string,
): Promise<{ kind: 'PATIENT' | 'CONTACT'; id: string } | null> {
  const patientId = patientIdFromKey(patientKey);
  if (patientId) return { kind: 'PATIENT', id: patientId };
  const phone = phoneFromPatientKey(patientKey);
  if (phone) {
    const contact = await findPatientByPhone(tenantId, phone);
    return contact ? { kind: 'CONTACT', id: contact.id } : null;
  }
  // ghl:/email:/anon: — vienen del CRM o de citas sueltas; no hay fila que borrar.
  return null;
}

export async function patientRemovalPreviewAction(
  patientKey: string,
): Promise<Result<RemovalPreview>> {
  try {
    const ctx = await requireAgendaManager();
    const target = await resolveTarget(ctx.tenantId, patientKey);
    if (!target) return { ok: false, error: 'Este paciente no se gestiona desde aquí.' };

    if (target.kind === 'PATIENT') {
      const p = await previewPatientDeletion(ctx.tenantId, target.id);
      if (!p) return { ok: false, error: 'Ese paciente ya no existe.' };
      return {
        ok: true,
        data: {
          kind: 'PATIENT',
          name: p.fullName,
          appointments: p.appointments,
          notes: p.notes,
          warning: p.signedConsents > 0 ? 'Tiene un consentimiento firmado.' : null,
          canDelete: p.canDelete,
        },
      };
    }

    const c = await previewContactDeletion(ctx.tenantId, target.id);
    if (!c) return { ok: false, error: 'Ese contacto ya no existe.' };
    const partes = [
      c.patients > 0 ? `${c.patients} paciente(s) a su cargo` : null,
      c.messages > 0 ? `${c.messages} mensaje(s) de WhatsApp que se borrarían con él` : null,
    ].filter((s): s is string => s !== null);
    return {
      ok: true,
      data: {
        kind: 'CONTACT',
        name: c.name?.trim() || c.phone,
        appointments: c.appointments,
        notes: c.notes,
        warning: partes.length > 0 ? partes.join(' · ') : null,
        canDelete: c.canDelete,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function removePatientAction(patientKey: string): Promise<Result<null>> {
  try {
    const ctx = await requireAgendaManager();
    const target = await resolveTarget(ctx.tenantId, patientKey);
    if (!target) return { ok: false, error: 'Este paciente no se gestiona desde aquí.' };
    if (target.kind === 'PATIENT') {
      await deletePatient({ tenantId: ctx.tenantId, userId: ctx.userId }, target.id);
    } else {
      await deleteContact(ctx.tenantId, target.id);
    }
    revalidatePath('/dashboard/agenda/pacientes');
    revalidatePath('/dashboard/agenda');
    return { ok: true, data: null };
  } catch (err) {
    return fail(err);
  }
}
