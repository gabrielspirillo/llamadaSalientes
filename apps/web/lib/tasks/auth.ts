import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

export type TaskRole = 'admin' | 'operator' | 'viewer';

const ORDER: Record<TaskRole, number> = { viewer: 0, operator: 1, admin: 2 };

export class TaskForbiddenError extends Error {
  constructor(
    public actual: TaskRole,
    public required: TaskRole,
  ) {
    super(`Rol ${actual} insuficiente, se requiere ${required}+`);
    this.name = 'TaskForbiddenError';
  }
}

export interface TaskAuthContext {
  tenantId: string;
  clerkOrganizationId: string;
  /** users.id interno — el que referencian task_assignees y task_comments. */
  userId: string;
  clerkUserId: string;
  role: TaskRole;
}

/**
 * Gate de rol del módulo Tareas.
 *
 * Criterio: `viewer` mira el tablero, `operator` crea/mueve/cierra tareas
 * (es la recepcionista y el resto del equipo), `admin` toca rutinas y
 * automatizaciones — ahí es donde se define el estándar de la clínica.
 */
export async function requireTaskRole(min: TaskRole): Promise<TaskAuthContext> {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  const [m] = await db
    .select({ role: tenantMemberships.role, internalUserId: users.id })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)))
    .limit(1);

  if (!m) throw new TaskForbiddenError('viewer', min);

  const role = normalizeRole(m.role);
  if (ORDER[role] < ORDER[min]) throw new TaskForbiddenError(role, min);

  return {
    tenantId: tenant.id,
    clerkOrganizationId: tenant.clerkOrganizationId,
    userId: m.internalUserId,
    clerkUserId,
    role,
  };
}

export function normalizeRole(raw: string | null | undefined): TaskRole {
  const v = (raw ?? '').replace(/^org:/, '');
  if (v === 'admin') return 'admin';
  if (v === 'viewer') return 'viewer';
  // basic_member / member / operator y cualquier otro rol de Clerk operan.
  return 'operator';
}
