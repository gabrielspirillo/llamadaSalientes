import 'server-only';

import { type TenantRole, resolveTenantRole, roleSatisfies } from '@/lib/auth/tenant-role';

export type ReminderRole = TenantRole;

// Devuelve { tenantId, userId (uuid interno), role } si el usuario tiene al
// menos el rol requerido. Si no, lanza ReminderForbiddenError (403) o deja
// que el error de auth/tenant burbujee (401).
//
// El rol y el `users.id` interno salen de `resolveTenantRole()`, la misma
// fuente que el resto de gates: es lo que hace que Futura, que gestiona las
// clínicas sin ser miembro, sea admin aquí también.
export async function requireReminderRole(min: ReminderRole): Promise<{
  tenantId: string;
  userId: string;
  role: ReminderRole;
}> {
  const ctx = await resolveTenantRole();

  // Sin membresía en este tenant (puede pasar si el webhook de Clerk
  // organization.membership.created no se disparó) se trata como viewer para
  // que la verificación de rol decida.
  if (ctx.role === null) throw new ReminderForbiddenError('viewer', min);
  if (!roleSatisfies(ctx.role, min)) throw new ReminderForbiddenError(ctx.role, min);

  return { tenantId: ctx.tenantId, userId: ctx.internalUserId, role: ctx.role };
}

export class ReminderForbiddenError extends Error {
  constructor(
    public actual: ReminderRole,
    public required: ReminderRole,
  ) {
    super(`Rol ${actual} insuficiente, se requiere ${required}+`);
    this.name = 'ReminderForbiddenError';
  }
}
