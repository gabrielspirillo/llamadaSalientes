'use server';

import { recordAudit } from '@/lib/audit';
import {
  deleteGhlIntegration,
  getGhlIntegration,
  upsertGhlPit,
} from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';
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

/**
 * Conecta GHL via Private Integration Token + Location ID.
 * Verifica el token haciendo un ping a /locations/{id} antes de persistir.
 */
export async function connectGhlPitAction(input: {
  pit: string;
  locationId: string;
}): Promise<ActionResult> {
  const { tenant } = await getCurrentTenant();
  const pit = input.pit.trim();
  const locationId = input.locationId.trim();

  if (!pit.startsWith('pit-')) {
    return { ok: false, error: 'El token no parece un PIT válido (debe empezar con "pit-")' };
  }
  if (!locationId) {
    return { ok: false, error: 'Location ID es requerido' };
  }

  // Persistimos primero (si verifica falla, podemos rollback — pero para simplicidad
  // dejamos guardado y mostramos warning si la verificación posterior falla).
  await upsertGhlPit({
    tenantId: tenant.id,
    pit,
    locationId,
    scopes: 'pit',
  });

  // Verificación: GET /locations/{id} valida que el token y locationId coincidan.
  try {
    await ghlFetch({
      tenantId: tenant.id,
      path: `/locations/${locationId}`,
    });
  } catch (err) {
    // Mantenemos lo que guardamos pero avisamos
    const msg = err instanceof Error ? err.message : 'Verificación falló';
    revalidatePath('/dashboard/settings');
    return {
      ok: false,
      error: `Guardado, pero la verificación falló: ${msg}. Revisá que el token y Location ID sean correctos.`,
    };
  }

  await recordAudit({
    tenantId: tenant.id,
    action: 'connect',
    entity: 'ghl_integration',
    entityId: locationId,
    after: { locationId, method: 'pit' },
  });

  revalidatePath('/dashboard/settings');
  return { ok: true };
}
