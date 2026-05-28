import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

export type WaitlistRole = 'admin' | 'operator' | 'viewer';
const ORDER: Record<WaitlistRole, number> = { viewer: 0, operator: 1, admin: 2 };

export async function requireWaitlistRole(min: WaitlistRole): Promise<{
  tenantId: string;
  userId: string;
  role: WaitlistRole;
}> {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  const [m] = await db
    .select({ role: tenantMemberships.role, internalUserId: users.id })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(
      and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)),
    )
    .limit(1);

  if (!m) throw new WaitlistForbiddenError('viewer', min);
  const role = (m.role as WaitlistRole | undefined) ?? 'viewer';
  if (ORDER[role] < ORDER[min]) throw new WaitlistForbiddenError(role, min);
  return { tenantId: tenant.id, userId: m.internalUserId, role };
}

export class WaitlistForbiddenError extends Error {
  constructor(public actual: WaitlistRole, public required: WaitlistRole) {
    super(`Rol ${actual} insuficiente, se requiere ${required}+`);
    this.name = 'WaitlistForbiddenError';
  }
}
