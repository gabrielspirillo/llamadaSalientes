import 'server-only';

import { findProfessionalForClerkUser, isAgendaOnly } from '@/lib/agenda/access';
import { type TenantRole, resolveTenantRole, roleSatisfies } from '@/lib/auth/tenant-role';

export type TaskRole = TenantRole;

// Medio panel importa `normalizeRole` de aquí desde antes de que existiera
// `lib/auth/tenant-role.ts`; se reexporta para no tocarlo todo.
export { normalizeRole } from '@/lib/auth/tenant-role';

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
 * Gate de rol del módulo Tareas y, a través de `denyUnlessRole`, del resto
 * del panel.
 *
 * Criterio: `viewer` mira el tablero, `operator` crea/mueve/cierra tareas
 * (es la recepcionista y el resto del equipo), `admin` toca rutinas y
 * automatizaciones — ahí es donde se define el estándar de la clínica.
 *
 * El rol sale de `resolveTenantRole()`: Futura es admin en cualquier clínica
 * que gestione, aunque no sea miembro.
 */
export async function requireTaskRole(min: TaskRole): Promise<TaskAuthContext> {
  const ctx = await resolveTenantRole();

  if (ctx.role === null) throw new TaskForbiddenError('viewer', min);
  if (!roleSatisfies(ctx.role, min)) throw new TaskForbiddenError(ctx.role, min);

  // Un profesional con acceso restringido a su agenda no escribe en el resto
  // del panel. Este es el gate de rol por el que pasan las Server Actions y los
  // route handlers (`denyUnlessRole`), así que aquí se cierra de verdad: la
  // agenda usa su propio contexto (`lib/agenda/auth.ts`) y no pasa por acá.
  const professional = await findProfessionalForClerkUser(ctx.tenantId, ctx.clerkUserId);
  if (isAgendaOnly(professional, { role: ctx.role, isSuperAdmin: ctx.isSuperAdmin })) {
    throw new TaskForbiddenError(ctx.role, min);
  }

  return {
    tenantId: ctx.tenantId,
    clerkOrganizationId: ctx.clerkOrganizationId,
    userId: ctx.internalUserId,
    clerkUserId: ctx.clerkUserId,
    role: ctx.role,
  };
}
