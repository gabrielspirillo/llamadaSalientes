'use server';

import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { isModuleKey, isSuperAdminTenant } from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export async function toggleModuleAction(
  targetTenantId: string,
  moduleKey: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tenant } = await getCurrentTenant();

  if (!isSuperAdminTenant(tenant.id)) {
    return { ok: false, error: 'Forbidden' };
  }
  if (!isModuleKey(moduleKey)) {
    return { ok: false, error: 'Módulo desconocido' };
  }

  // Concat jsonb (||) pisa la key existente con el nuevo valor sin tocar el resto.
  const patch = JSON.stringify({ [moduleKey]: Boolean(enabled) });

  await db
    .update(tenants)
    .set({
      enabledModules: sql`${tenants.enabledModules} || ${patch}::jsonb`,
    })
    .where(eq(tenants.id, targetTenantId));

  revalidatePath('/dashboard/configuration');
  // El layout del dashboard fetchea enabledModules → revalidar para refrescar sidebar.
  revalidatePath('/dashboard', 'layout');

  return { ok: true };
}
