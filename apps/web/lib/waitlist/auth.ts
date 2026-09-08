import 'server-only';

import { type TenantRole, resolveTenantRole, roleSatisfies } from '@/lib/auth/tenant-role';

export type WaitlistRole = TenantRole;

// El rol sale de `resolveTenantRole()`, que ya normaliza los roles crudos de
// Clerk (`member`, `org:admin`) y trata a Futura como admin en cualquier
// clínica que gestione.
export async function requireWaitlistRole(min: WaitlistRole): Promise<{
  tenantId: string;
  userId: string;
  role: WaitlistRole;
}> {
  const ctx = await resolveTenantRole();

  if (ctx.role === null) throw new WaitlistForbiddenError('viewer', min);
  if (!roleSatisfies(ctx.role, min)) throw new WaitlistForbiddenError(ctx.role, min);

  return { tenantId: ctx.tenantId, userId: ctx.internalUserId, role: ctx.role };
}

export class WaitlistForbiddenError extends Error {
  constructor(
    public actual: WaitlistRole,
    public required: WaitlistRole,
  ) {
    super(`Rol ${actual} insuficiente, se requiere ${required}+`);
    this.name = 'WaitlistForbiddenError';
  }
}
