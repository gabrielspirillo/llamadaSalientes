'use server';

import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { isSuperAdminTenant } from '@/lib/modules';
import { getCurrentTenant } from '@/lib/tenant';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type ActivateResult = { ok: true } | { ok: false; error: string };

/**
 * Activa una clínica (status → 'active'). Solo Futura (super-admin). Es el
 * paso final del alta: la clínica completó el onboarding y quedó 'pending';
 * acá Futura la deja operativa.
 */
export async function activateClinicAction(targetTenantId: string): Promise<ActivateResult> {
  const { tenant } = await getCurrentTenant();
  if (!isSuperAdminTenant(tenant.id)) {
    return { ok: false, error: 'No autorizado.' };
  }

  await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, targetTenantId));

  revalidatePath('/dashboard/futura');
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}
