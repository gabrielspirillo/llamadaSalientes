import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

export type ReminderRole = 'admin' | 'operator' | 'viewer';

const ORDER: Record<ReminderRole, number> = { viewer: 0, operator: 1, admin: 2 };

// Devuelve { tenantId, userId (uuid interno), role } si el usuario tiene al
// menos el rol requerido. Si no, lanza ReminderForbiddenError (403) o deja
// que el error de auth/tenant burbujee (401).
//
// Nota: getCurrentTenant devuelve el `userId` de Clerk (string), no el uuid
// interno. Acá hacemos JOIN a `users` por clerk_user_id para obtener el
// users.id que es lo que tenant_memberships, audit_logs y FK referencian.
export async function requireReminderRole(min: ReminderRole): Promise<{
  tenantId: string;
  userId: string;
  role: ReminderRole;
}> {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  const [m] = await db
    .select({
      role: tenantMemberships.role,
      internalUserId: users.id,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(
      and(
        eq(tenantMemberships.tenantId, tenant.id),
        eq(users.clerkUserId, clerkUserId),
      ),
    )
    .limit(1);

  if (!m) {
    // El usuario no tiene membership en este tenant (puede pasar si el
    // webhook de Clerk organization.membership.created no se disparó). Lo
    // tratamos como viewer para que la verificación de rol decida.
    throw new ReminderForbiddenError('viewer', min);
  }

  const role = (m.role as ReminderRole | undefined) ?? 'viewer';
  if (ORDER[role] < ORDER[min]) {
    throw new ReminderForbiddenError(role, min);
  }

  return { tenantId: tenant.id, userId: m.internalUserId, role };
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
