'use server';

import { revalidatePath } from 'next/cache';

import {
  AgendaForbiddenError,
  assertProfessionalInScope,
  requireAgendaManager,
  requireAgendaWriter,
} from '@/lib/agenda/auth';
import { getAppointment } from '@/lib/agenda/queries';
import {
  AgendaValidationError,
  type AppointmentInput,
  type ProfessionalDeletionPreview,
  type ProfessionalInput,
  type ShiftInput,
  addTimeOff,
  cancelAppointment,
  createAppointment,
  createProfessional,
  deactivateProfessional,
  deleteProfessional,
  previewProfessionalDeletion,
  reactivateProfessional,
  removeTimeOff,
  replaceShifts,
  rescheduleAppointment,
  saveClinicalNote,
  setProfessionalTreatments,
  updateAppointment,
  updateProfessional,
} from '@/lib/agenda/service';
import { type TeamCandidate, listTeamCandidates } from '@/lib/agenda/team';
import { recordAudit } from '@/lib/audit';
import { createTreatment, listTreatmentsForTenant } from '@/lib/data/treatments';

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof AgendaValidationError || err instanceof AgendaForbiddenError) {
    return { ok: false, error: err.message };
  }
  // Zod y el resto: se devuelve algo legible, no un stack.
  if (err instanceof Error && err.name === 'ZodError') {
    try {
      const issues = JSON.parse(err.message) as { message: string }[];
      return { ok: false, error: issues[0]?.message ?? 'Datos inválidos.' };
    } catch {
      return { ok: false, error: 'Datos inválidos.' };
    }
  }
  console.error('[agenda-action]', err);
  return { ok: false, error: 'No se pudo completar la operación.' };
}

function revalidateAgenda() {
  revalidatePath('/dashboard/agenda');
  revalidatePath('/dashboard/agenda/profesionales');
}

// ─── Alta guiada del profesional ─────────────────────────────────────────────

/**
 * El equipo que ya está invitado al panel, para no volver a teclear a nadie.
 *
 * Va como acción y no como prop de la página porque tira de Clerk: cargarlo en
 * cada render de la lista de profesionales pagaría esa llamada siempre, y sólo
 * hace falta cuando alguien abre el alta.
 */
export async function listTeamCandidatesAction(): Promise<ActionResult<TeamCandidate[]>> {
  try {
    const ctx = await requireAgendaManager();
    const data = await listTeamCandidates(ctx.tenantId, ctx.clerkOrganizationId);
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

export interface TreatmentOptionData {
  id: string;
  name: string;
  durationMinutes: number;
  active: boolean | null;
}

/** Catálogo de tratamientos de la clínica, para el paso de "qué hace". */
export async function listTreatmentOptionsAction(): Promise<ActionResult<TreatmentOptionData[]>> {
  try {
    const ctx = await requireAgendaManager();
    const rows = await listTreatmentsForTenant(ctx.tenantId);
    return {
      ok: true,
      data: rows.map((t) => ({
        id: t.id,
        name: t.name,
        durationMinutes: t.durationMinutes,
        active: t.active,
      })),
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Alta rápida de tratamiento desde el asistente del profesional.
 *
 * Una clínica que aún no cargó el catálogo se quedaba bloqueada: tenía que
 * salirse a Tratamientos, cargarlo y volver a empezar el alta. Es el mismo
 * `createTreatment` de la sección de Tratamientos, sin el calendario de GHL —
 * eso sigue siendo cosa de aquella pantalla.
 */
export async function createTreatmentQuickAction(input: {
  name: string;
  durationMinutes: number;
}): Promise<ActionResult<TreatmentOptionData>> {
  try {
    const ctx = await requireAgendaManager();
    const name = input.name?.trim() ?? '';
    if (name.length < 2) {
      return { ok: false, error: 'El nombre del tratamiento es demasiado corto.' };
    }
    const duracion = Number(input.durationMinutes);
    if (!Number.isFinite(duracion) || duracion < 5 || duracion > 480) {
      return { ok: false, error: 'La duración tiene que estar entre 5 y 480 minutos.' };
    }

    const row = await createTreatment({
      tenantId: ctx.tenantId,
      name,
      durationMinutes: Math.round(duracion),
    });
    if (!row) return { ok: false, error: 'No se pudo crear el tratamiento.' };

    await recordAudit({
      tenantId: ctx.tenantId,
      action: 'create',
      entity: 'treatment',
      entityId: row.id,
      after: { name: row.name, durationMinutes: row.durationMinutes },
    }).catch(() => undefined);

    revalidatePath('/dashboard/treatments');
    revalidateAgenda();

    return {
      ok: true,
      data: {
        id: row.id,
        name: row.name,
        durationMinutes: row.durationMinutes,
        active: row.active,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

// ─── Profesionales ───────────────────────────────────────────────────────────

export async function createProfessionalAction(
  input: ProfessionalInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAgendaManager();
    const row = await createProfessional(ctx, input);
    if (!row) return { ok: false, error: 'No se pudo crear el profesional.' };
    await recordAudit({
      tenantId: ctx.tenantId,
      action: 'create',
      entity: 'professional',
      entityId: row.id,
      after: { fullName: row.fullName, agendaEnabled: row.agendaEnabled },
    }).catch(() => undefined);
    revalidateAgenda();
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateProfessionalAction(
  professionalId: string,
  patch: Partial<ProfessionalInput>,
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    await updateProfessional(ctx, professionalId, patch);
    await recordAudit({
      tenantId: ctx.tenantId,
      action: 'update',
      entity: 'professional',
      entityId: professionalId,
      after: patch as Record<string, unknown>,
    }).catch(() => undefined);
    revalidateAgenda();
    revalidatePath(`/dashboard/agenda/profesionales/${professionalId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** El interruptor de "habilitar la agenda" de la ficha y de la lista. */
export async function setAgendaEnabledAction(
  professionalId: string,
  enabled: boolean,
): Promise<ActionResult> {
  return updateProfessionalAction(professionalId, { agendaEnabled: enabled });
}

export async function deactivateProfessionalAction(professionalId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    await deactivateProfessional(ctx, professionalId);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reactivateProfessionalAction(professionalId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    await reactivateProfessional(ctx, professionalId);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Qué arrastra el profesional antes de decidir si se borra o se da de baja.
 * Se pregunta ANTES de enseñar el botón definitivo: el diálogo tiene que decir
 * exactamente qué va a pasar.
 */
export async function professionalDeletionPreviewAction(
  professionalId: string,
): Promise<ActionResult<ProfessionalDeletionPreview>> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    const data = await previewProfessionalDeletion(ctx, professionalId);
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

/** Borrado de verdad. El servicio lo rechaza si el profesional tiene historia. */
export async function deleteProfessionalAction(professionalId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    const row = await deleteProfessional(ctx, professionalId);
    await recordAudit({
      tenantId: ctx.tenantId,
      action: 'delete',
      entity: 'professional',
      entityId: professionalId,
      before: { fullName: row.fullName },
    }).catch(() => undefined);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setProfessionalTreatmentsAction(
  professionalId: string,
  items: { treatmentId: string; durationOverrideMinutes?: number | null }[],
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    await setProfessionalTreatments(ctx, professionalId, items);
    revalidatePath(`/dashboard/agenda/profesionales/${professionalId}`);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveScheduleAction(
  professionalId: string,
  shifts: ShiftInput[],
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaManager();
    await assertProfessionalInScope(ctx, professionalId);
    await replaceShifts(ctx, professionalId, shifts);
    await recordAudit({
      tenantId: ctx.tenantId,
      action: 'update',
      entity: 'professional_schedule',
      entityId: professionalId,
      after: { shifts: shifts.length },
    }).catch(() => undefined);
    revalidatePath(`/dashboard/agenda/profesionales/${professionalId}`);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ─── Bloqueos ────────────────────────────────────────────────────────────────
//
// A diferencia de la configuración, un bloqueo lo puede poner también el propio
// profesional sobre SU agenda: es lo que hace que "el martes no vengo" no tenga
// que pasar por el administrador.

export async function addTimeOffAction(
  professionalId: string,
  block: {
    startsAt?: string;
    endsAt?: string;
    startDateKey?: string;
    startMinute?: number;
    endDateKey?: string;
    endMinute?: number;
    allDay?: boolean;
    kind?: 'TIME_OFF' | 'HOLIDAY' | 'BREAK' | 'OTHER';
    reason?: string;
  },
): Promise<ActionResult<{ conflictingAppointments: number }>> {
  try {
    const ctx = await requireAgendaWriter();
    await assertProfessionalInScope(ctx, professionalId);
    const result = await addTimeOff(ctx, professionalId, block);
    revalidatePath(`/dashboard/agenda/profesionales/${professionalId}`);
    revalidateAgenda();
    return { ok: true, data: { conflictingAppointments: result.conflictingAppointments } };
  } catch (err) {
    return fail(err);
  }
}

export async function removeTimeOffAction(blockId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaWriter();
    const row = await removeTimeOff(ctx, blockId);
    revalidatePath(`/dashboard/agenda/profesionales/${row.professionalId}`);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ─── Citas ───────────────────────────────────────────────────────────────────

export async function createAppointmentAction(
  input: AppointmentInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await requireAgendaWriter();
    await assertProfessionalInScope(ctx, input.professionalId);
    const { appointment } = await createAppointment(ctx, { ...input, source: 'PANEL' });
    revalidateAgenda();
    return { ok: true, data: { id: appointment.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function rescheduleAppointmentAction(
  appointmentId: string,
  params: {
    startsAt?: string;
    startDateKey?: string;
    startMinute?: number;
    durationMinutes?: number;
    professionalId?: string;
    allowOutsideHours?: boolean;
  },
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaWriter();
    if (params.professionalId) await assertProfessionalInScope(ctx, params.professionalId);
    await rescheduleAppointment(ctx, appointmentId, params);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function updateAppointmentAction(
  appointmentId: string,
  patch: {
    status?:
      | 'SCHEDULED'
      | 'CONFIRMED'
      | 'ARRIVED'
      | 'IN_PROGRESS'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'NO_SHOW';
    notes?: string | null;
    patientName?: string;
    patientPhone?: string | null;
    treatmentId?: string | null;
  },
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaWriter();
    await assertAppointmentInScope(
      ctx.tenantId,
      appointmentId,
      ctx.scope === 'OWN' ? ctx.professional?.id : undefined,
    );
    await updateAppointment(ctx, appointmentId, patch);
    revalidateAgenda();
    revalidatePath('/dashboard/agenda/pacientes');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelAppointmentAction(
  appointmentId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaWriter();
    await assertAppointmentInScope(
      ctx.tenantId,
      appointmentId,
      ctx.scope === 'OWN' ? ctx.professional?.id : undefined,
    );
    await cancelAppointment(ctx, appointmentId, reason);
    revalidateAgenda();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ─── Historia clínica ────────────────────────────────────────────────────────

export async function saveClinicalNoteAction(
  input: {
    appointmentId?: string | null;
    professionalId: string;
    patientKey: string;
    patientName?: string;
    summary: string;
    treatmentPerformed?: string;
    observations?: string;
    nextSteps?: string;
    private?: boolean;
  },
  noteId?: string,
): Promise<ActionResult> {
  try {
    const ctx = await requireAgendaWriter();
    if (!ctx.canWriteClinicalNotes) {
      throw new AgendaForbiddenError('Tu rol no permite escribir historia clínica.');
    }
    await assertProfessionalInScope(ctx, input.professionalId);
    await saveClinicalNote(ctx, input, noteId);
    revalidatePath('/dashboard/agenda/pacientes');
    revalidatePath(`/dashboard/agenda/pacientes/${encodeURIComponent(input.patientKey)}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * La cita se identifica por id, que llega del cliente: hay que comprobar que es
 * de este tenant — y, si quien escribe es un profesional restringido, que es
 * suya — antes de dejar tocarla.
 */
async function assertAppointmentInScope(
  tenantId: string,
  appointmentId: string,
  onlyProfessionalId?: string,
): Promise<void> {
  const appointment = await getAppointment(tenantId, appointmentId);
  if (!appointment) throw new AgendaValidationError('Esa cita ya no existe.');
  if (onlyProfessionalId && appointment.professionalId !== onlyProfessionalId) {
    throw new AgendaForbiddenError('Esa cita no es de tu agenda.');
  }
}
