import 'server-only';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { BUSY_STATUSES } from '@/lib/agenda/shared';
import { db } from '@/lib/db/client';
import { agendaAppointments, clinicalNotes } from '@/lib/db/schema';
import { samePhoneSql } from '@/lib/patients/registry';
import { FOLD_FROM, FOLD_TO, foldSearchText } from '@/lib/patients/search-text';

type Executor = Pick<typeof db, 'select'>;

/**
 * ¿El paciente ya tiene historia en la clínica? Una cita que ocupa o ocupó
 * hueco (atendida, agendada, confirmada…) o una nota clínica. Con historia
 * NO es primera visita aunque el tratamiento elegido se llame "Primera
 * visita": eso es sólo para quien empieza de cero.
 */
export async function patientHasHistory(
  tenantId: string,
  who: {
    patientId?: string | null;
    patientKey?: string | null;
    /**
     * Citas de antes de tener ficha (clave `tel:`): mismo teléfono y mismo
     * nombre. Sin esto, al abrirle ficha a un niño que ya venía, su primera
     * cita con ficha salía como "primera visita".
     */
    phone?: string | null;
    name?: string | null;
  },
  executor: Executor = db,
): Promise<boolean> {
  const digits = (who.phone ?? '').replace(/\D/g, '').slice(-9);
  const byPhoneAndName =
    who.patientId && digits.length === 9 && who.name?.trim()
      ? and(
          isNull(agendaAppointments.patientId),
          samePhoneSql(agendaAppointments.patientPhone, digits),
          sql`lower(translate(coalesce(${agendaAppointments.patientName}, ''), ${FOLD_FROM}, ${FOLD_TO})) = ${foldSearchText(who.name.trim()).toLowerCase()}`,
        )
      : undefined;
  const apptBy = [
    who.patientId ? eq(agendaAppointments.patientId, who.patientId) : undefined,
    who.patientKey ? eq(agendaAppointments.patientKey, who.patientKey) : undefined,
    byPhoneAndName,
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
