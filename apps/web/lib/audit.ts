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
  | 'membership';

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
