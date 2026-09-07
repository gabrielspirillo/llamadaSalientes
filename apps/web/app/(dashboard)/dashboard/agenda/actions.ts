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
  type ProfessionalInput,
  type ShiftInput,
  addTimeOff,
  cancelAppointment,
  createAppointment,
  createProfessional,
  deactivateProfessional,
  removeTimeOff,
  replaceShifts,
  rescheduleAppointment,
  saveClinicalNote,
  setProfessionalTreatments,
  updateAppointment,
  updateProfessional,
} from '@/lib/agenda/service';
import { recordAudit } from '@/lib/audit';

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
