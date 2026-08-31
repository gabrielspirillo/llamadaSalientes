import 'server-only';
import { requireOrg } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { findTenantById, getActingTenantId } from '@/lib/impersonation';
import { isSuperAdminTenant } from '@/lib/modules';
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

// Resuelve el tenant de una org de Clerk, auto-provisionándolo si falta.
// Separado de getCurrentTenant (que lo envuelve en React.cache + requireOrg)
// para poder testearlo sin el contexto de request de cache().
export async function resolveTenantForOrg(orgId: string, userId: string) {
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
}

// Mapea Clerk org_id → fila de tenant. Cacheado por request (React.cache).
//
// Impersonación (Camino A): si el usuario real es super-admin (Futura) y hay
// una cookie "actuando como clínica X", devuelve la clínica X en `tenant` para
// que TODOS los paneles/acciones (que usan getCurrentTenant) operen sobre ella.
// La cookie SOLO se respeta para super-admin — se re-valida acá en cada request.
// `isSuperAdmin` refleja SIEMPRE al usuario real (para gates de UI), y
// `realTenant` es la clínica de Futura aunque se esté impersonando.
export const getCurrentTenant = cache(async () => {
  const { orgId, userId } = await requireOrg();
  const { tenant: realTenant } = await resolveTenantForOrg(orgId, userId);
  const isSuperAdmin = isSuperAdminTenant(realTenant.id);

  if (isSuperAdmin) {
    const actingId = await getActingTenantId();
    if (actingId && actingId !== realTenant.id) {
      const acting = await findTenantById(actingId);
      if (acting) {
        return { tenant: acting, userId, isSuperAdmin, impersonating: true as const, realTenant };
      }
    }
  }

  return { tenant: realTenant, userId, isSuperAdmin, impersonating: false as const, realTenant };
});

// Versión no-throw: útil en componentes que solo quieren saber si hay tenant.
export async function getCurrentTenantOrNull() {
  try {
    return await getCurrentTenant();
  } catch {
    return null;
  }
}
