import 'server-only';
import { db } from '@/lib/db/client';
import { auditLogs } from '@/lib/db/schema';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'invite'
  | 'remove'
  | 'connect'
  | 'disconnect';

export type AuditEntity =
  | 'tenant'
  | 'clinic_settings'
  | 'treatment'
  | 'faq'
  | 'agent_config'
  | 'agent_prompt_version'
  | 'phone_number'
  | 'ghl_integration'
  | 'membership'
  | 'tenant_telephony'
  // Módulo Agenda (migración 0026).
  | 'professional'
  // Paciente como persona (migración 0030).
  | 'patient'
  | 'professional_schedule'
  | 'agenda_appointment'
  // Cobros por cita (migración 0034).
  | 'patient_charge'
  // Historia clínica y consentimiento: entran en la actividad de la ficha.
  | 'clinical_note'
  | 'patient_consent'
  // Módulo Finanzas (migración 0036).
  | 'finance_entry'
  | 'finance_category'
  | 'finance_settings';

export async function recordAudit(input: {
  tenantId: string;
  actorUserId?: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  try {
    await db.insert(auditLogs).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
    });
  } catch (err) {
    // Audit nunca debe romper la operación principal.
    console.error('audit_failed', err);
  }
}
