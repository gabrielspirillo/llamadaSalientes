import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { tenantMemberships } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

export type ReminderRole = 'admin' | 'operator' | 'viewer';

const ORDER: Record<ReminderRole, number> = { viewer: 0, operator: 1, admin: 2 };

// Devuelve { tenant, userId, role } si el usuario tiene al menos el rol
// requerido. Tira Response 403 si no.
export async function requireReminderRole(min: ReminderRole): Promise<{
  tenantId: string;
  userId: string;
  role: ReminderRole;
}> {
  const { tenant, userId } = await getCurrentTenant();

  const [m] = await db
    .select({ role: tenantMemberships.role })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenant.id),
        eq(tenantMemberships.userId, userId),
      ),
    )
    .limit(1);

  const role = (m?.role as ReminderRole | undefined) ?? 'viewer';
  if (ORDER[role] < ORDER[min]) {
    throw new ReminderForbiddenError(role, min);
  }

  return { tenantId: tenant.id, userId, role };
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
