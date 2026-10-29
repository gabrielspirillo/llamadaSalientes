import 'server-only';
import { and, eq, inArray, or } from 'drizzle-orm';

import { BUSY_STATUSES } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import { agendaAppointments, clinicalNotes } from '@/lib/db/schema';

type Executor = Pick<typeof db, 'select'>;

/**
 * ¿El paciente ya tiene historia en la clínica? Una cita que ocupa o ocupó
 * hueco (atendida, agendada, confirmada…) o una nota clínica. Con historia
 * NO es primera visita aunque el tratamiento elegido se llame "Primera
 * visita": eso es sólo para quien empieza de cero.
 */
export async function patientHasHistory(
  tenantId: string,
  who: { patientId?: string | null; patientKey?: string | null },
  executor: Executor = db,
): Promise<boolean> {
  const apptBy = [
    who.patientId ? eq(agendaAppointments.patientId, who.patientId) : undefined,
    who.patientKey ? eq(agendaAppointments.patientKey, who.patientKey) : undefined,
  ].filter(Boolean);
  const noteBy = [
    who.patientId ? eq(clinicalNotes.patientId, who.patientId) : undefined,
    who.patientKey ? eq(clinicalNotes.patientKey, who.patientKey) : undefined,
  ].filter(Boolean);
  if (apptBy.length === 0) return false;

  const [appt, note] = await Promise.all([
    executor
      .select({ id: agendaAppointments.id })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          inArray(agendaAppointments.status, BUSY_STATUSES),
          or(...apptBy),
        ),
      )
      .limit(1),
    executor
      .select({ id: clinicalNotes.id })
      .from(clinicalNotes)
      .where(and(eq(clinicalNotes.tenantId, tenantId), or(...noteBy)))
      .limit(1),
  ]);
  return appt.length > 0 || note.length > 0;
}

/**
 * La regla de una vez: con historia nunca es primera; sin historia, lo que
 * diga el tratamiento (unos mellizos van como seguimiento) y si no dice nada,
 * primera.
 */
export function decideFirstVisit(hasHistory: boolean, byTreatment: boolean | null): boolean {
  if (hasHistory) return false;
  return byTreatment ?? true;
}
