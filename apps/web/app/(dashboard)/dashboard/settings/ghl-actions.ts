'use server';

import { recordAudit } from '@/lib/audit';
import { deleteGhlIntegration, getGhlIntegration } from '@/lib/data/ghl-integration';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function disconnectGhlAction(): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();

  const before = await getGhlIntegration(tenant.id);
  if (!before) return { ok: false, error: 'No hay integración GHL conectada' };

  await deleteGhlIntegration(tenant.id);

  await recordAudit({
    tenantId: tenant.id,
    action: 'disconnect',
    entity: 'ghl_integration',
    entityId: before.locationId,
    before: { locationId: before.locationId, scopes: before.scopes },
  });

  revalidatePath('/dashboard/settings');
  return { ok: true };
}
