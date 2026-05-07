import 'server-only';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

export class TenantNotFoundError extends Error {
  constructor(orgId: string) {
    super(`Tenant no existe para Clerk org ${orgId}`);
    this.name = 'TenantNotFoundError';
  }
}

// Mapea Clerk org_id → fila de tenant.
// Cacheado por request (React.cache) para evitar refetch en una misma página.
export const getCurrentTenant = cache(async () => {
  const { orgId, userId } = await requireOrg();

  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrganizationId, orgId))
    .limit(1);

  const tenant = rows[0];
  if (!tenant) {
    // Esto pasa solo si el webhook organization.created falló o todavía no llegó.
    // El usuario acaba de crear la org pero el webhook tarda 1-2s.
    throw new TenantNotFoundError(orgId);
  }

  return { tenant, userId };
});

// Versión no-throw: útil en componentes que solo quieren saber si hay tenant.
export async function getCurrentTenantOrNull() {
  try {
    return await getCurrentTenant();
  } catch {
    return null;
  }
}
