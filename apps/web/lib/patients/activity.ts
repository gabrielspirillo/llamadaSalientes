import 'server-only';
import { type SQL, and, desc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { auditLogs, users } from '@/lib/db/schema';

/**
 * La actividad de un paciente: quién tocó qué y cuándo. Sale de `audit_logs`,
 * que ya existía; lo nuevo es que cada acción sobre un paciente (datos,
 * anamnesis, marcas, notas, consentimiento, cobros) deja en `after` la
 * `patientKey`, que es lo que permite juntarlas aquí sin una tabla más.
 */

export interface PatientActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  createdAt: Date;
  after: Record<string, unknown> | null;
}

export async function listPatientActivity(
  tenantId: string,
  ref: { patientId: string | null; patientKey: string; chargeIds: string[] },
  limit = 60,
): Promise<PatientActivityEntry[]> {
  const matches: SQL[] = [sql`${auditLogs.after}->>'patientKey' = ${ref.patientKey}`];
  if (ref.patientId) {
    const byPatient = and(eq(auditLogs.entity, 'patient'), eq(auditLogs.entityId, ref.patientId));
    if (byPatient) matches.push(byPatient);
  }
  if (ref.chargeIds.length > 0) {
    const byCharge = and(
      eq(auditLogs.entity, 'patient_charge'),
      inArray(auditLogs.entityId, ref.chargeIds),
    );
    if (byCharge) matches.push(byCharge);
  }
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entity: auditLogs.entity,
      entityId: auditLogs.entityId,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(eq(auditLogs.tenantId, tenantId), or(...matches)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    actorEmail: r.actorEmail ?? null,
    createdAt: r.createdAt,
    after: r.after && typeof r.after === 'object' ? (r.after as Record<string, unknown>) : null,
  }));
}

/** Una línea legible por entrada: "Guardó la anamnesis", "Registró un pago de 45,00 €". */
export function describeActivity(entry: PatientActivityEntry): string {
  const after = entry.after ?? {};
  const field = typeof after.field === 'string' ? after.field : null;
  switch (entry.entity) {
    case 'patient':
      if (entry.action === 'create') return 'Dio de alta al paciente';
      if (field === 'anamnesis') return 'Guardó la anamnesis';
      if (field === 'marcas') return 'Cambió las marcas del paciente';
      if (field === 'revision') return 'Dio por valorado el aviso médico';
      return 'Editó los datos del paciente';
    case 'clinical_note':
      return after.private ? 'Escribió una nota clínica privada' : 'Escribió una nota clínica';
    case 'patient_consent':
      return entry.action === 'create'
        ? 'Envió el consentimiento informado'
        : 'Comprobó la firma del consentimiento';
    case 'patient_charge': {
      const cents = typeof after.amountCents === 'number' ? after.amountCents : null;
      if (typeof after.file === 'string') return `Adjuntó un comprobante (${after.file})`;
      return cents !== null
        ? `Registró un pago de ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100)}`
        : 'Registró un pago';
    }
    default:
      return `${entry.action} · ${entry.entity}`;
  }
}
