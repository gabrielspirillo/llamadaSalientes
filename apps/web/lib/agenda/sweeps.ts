import 'server-only';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { describePatientKey, phoneFromPatientKey } from '@/lib/agenda/patients';
import { db } from '@/lib/db/client';
import { agendaAppointments, clinicalNotes } from '@/lib/db/schema';

/**
 * Los dos barridos diarios de Tareas, resueltos con la agenda de la
 * plataforma.
 *
 * "Este presupuesto lleva tres semanas parado" y "a este paciente hace un año
 * que no lo vemos" no los anuncia ningún webhook: hay que recalcularlos. Hasta
 * aquí salían de `patients_cache`, la réplica del CRM, y esa tabla **no la
 * escribe nadie en el código de la aplicación**: los dos barridos no creaban
 * una sola tarea, ni con CRM conectado ni sin él.
 *
 * La agenda propia sí tiene los dos datos de primera mano: lo que el
 * profesional dejó anotado como siguiente paso, y cuándo fue la última visita
 * que se marcó como completada.
 */

export interface SweepPatient {
  /** Identidad estable dentro de la clínica. */
  patientKey: string;
  name: string;
  phone: string | null;
  lastVisitAt: Date | null;
  /** Lo que quedó pendiente, tal como lo escribió el profesional. */
  pending: string | null;
}

function nameFor(patientKey: string, patientName: string | null): string {
  return patientName?.trim() || describePatientKey(patientKey);
}

/**
 * Pacientes con un siguiente paso anotado en su historia clínica.
 *
 * Sólo cuenta la nota más reciente de cada paciente, y **nunca** una nota
 * privada: su contenido acabaría copiado en una tarea que ve todo el equipo, y
 * privada quiere decir justamente lo contrario.
 */
export async function patientsWithPendingFollowUp(
  tenantId: string,
  limit = 500,
): Promise<SweepPatient[]> {
  const rows = await db
    .select({
      patientKey: clinicalNotes.patientKey,
      patientName: clinicalNotes.patientName,
      nextSteps: clinicalNotes.nextSteps,
      createdAt: clinicalNotes.createdAt,
    })
    .from(clinicalNotes)
    .where(
      and(
        eq(clinicalNotes.tenantId, tenantId),
        eq(clinicalNotes.private, false),
        isNotNull(clinicalNotes.nextSteps),
        sql`length(trim(${clinicalNotes.nextSteps})) > 0`,
      ),
    )
    .orderBy(desc(clinicalNotes.createdAt))
    .limit(limit * 4);

  const seen = new Map<string, SweepPatient>();
  for (const r of rows) {
    if (seen.has(r.patientKey)) continue; // la primera es la más reciente
    seen.set(r.patientKey, {
      patientKey: r.patientKey,
      name: nameFor(r.patientKey, r.patientName),
      phone: phoneFromPatientKey(r.patientKey),
      lastVisitAt: r.createdAt,
      pending: r.nextSteps?.trim() ?? null,
    });
    if (seen.size >= limit) break;
  }
  return [...seen.values()];
}

/** Pacientes cuya última visita completada es anterior al corte. */
export async function inactivePatients(
  tenantId: string,
  cutoff: Date,
  limit = 200,
): Promise<SweepPatient[]> {
  const rows = await db
    .select({
      patientKey: agendaAppointments.patientKey,
      patientName: sql<string | null>`max(${agendaAppointments.patientName})`,
      patientPhone: sql<string | null>`max(${agendaAppointments.patientPhone})`,
      lastVisitAt: sql<Date>`max(${agendaAppointments.startsAt})`,
    })
    .from(agendaAppointments)
    .where(
      and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.status, 'COMPLETED')),
    )
    .groupBy(agendaAppointments.patientKey)
    // La fecha va como ISO con cast explícito: dentro de un fragmento `sql`
    // crudo el driver no sabe el tipo del parámetro y una Date suelta revienta
    // el bind. Mismo motivo que en `listAgendaPatients`.
    .having(sql`max(${agendaAppointments.startsAt}) < ${cutoff.toISOString()}::timestamptz`)
    .orderBy(sql`max(${agendaAppointments.startsAt}) asc`)
    .limit(limit);

  return rows.map((r) => ({
    patientKey: r.patientKey,
    name: nameFor(r.patientKey, r.patientName),
    phone: r.patientPhone ?? phoneFromPatientKey(r.patientKey),
    lastVisitAt: r.lastVisitAt ? new Date(r.lastVisitAt) : null,
    pending: null,
  }));
}
