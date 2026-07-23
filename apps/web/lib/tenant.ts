import 'server-only';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { ensureTenantForOrg } from '@/lib/provision-tenant';
import { clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { cache } from 'react';

export class TenantNotFoundError extends Error {
  constructor(orgId: string) {
    super(`Tenant no existe para Clerk org ${orgId}`);
    this.name = 'TenantNotFoundError';
  }
}

async function findTenantByOrg(orgId: string) {
  const rows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.clerkOrganizationId, orgId))
    .limit(1);
  return rows[0];
}

// Mapea Clerk org_id → fila de tenant.
// Cacheado por request (React.cache) para evitar refetch en una misma página.
export const getCurrentTenant = cache(async () => {
  const { orgId, userId } = await requireOrg();

  let tenant = await findTenantByOrg(orgId);

  if (!tenant) {
    // La org existe en Clerk pero no tiene tenant en la DB. Antes esto tiraba
    // un 500 (TenantNotFoundError) y rompía TODO el dashboard. Pasa cuando el
    // webhook organization.created no corrió o falló: org creada antes del
    // webhook, webhook mal configurado, o cutover de instancia de Clerk sin
    // re-setear el endpoint/secret. En vez de romper, auto-provisionamos el
    // tenant on-demand (idempotente) para que la app se auto-repare.
    const org = await (await clerkClient()).organizations.getOrganization({
      organizationId: orgId,
    });
    await ensureTenantForOrg({ clerkOrgId: orgId, name: org.name, slug: org.slug });
    tenant = await findTenantByOrg(orgId);
  }

  if (!tenant) {
    // Solo debería pasar si la provisión falló de verdad (p.ej. DB caída).
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
