import 'server-only';

import { SEED_CHANNELS } from '@/lib/messaging/constants';
import { ensureSlugChannel } from '@/lib/messaging/channels';
import { listTenantMembersSynced } from '@/lib/tenant-members';

/**
 * Siembra los canales del tenant en la primera visita al módulo, igual que
 * Tareas hace con `seedSystemTemplates()`.
 *
 * Idempotente por partida doble: el `dedupe_key` del canal impide duplicarlo y
 * el upsert de membresías reactiva a quien se había ido en vez de romper. Se
 * puede llamar en cada render sin efectos.
 *
 * Nunca lanza: si la migración `0019` todavía no corrió, el resto del panel no
 * puede caerse por esto.
 */
export async function seedMessagingForTenant(tenantId: string, clerkOrgId: string): Promise<void> {
  try {
    // Primero Clerk → `users` + `tenant_memberships`: `ensureSlugChannel` suma
    // como miembros a todo el tenant leyendo la tabla local, así que sin este
    // sync alguien recién invitado se quedaría fuera de los canales.
    await listTenantMembersSynced(tenantId, clerkOrgId);
  } catch (err) {
    console.warn('[messaging] seed: no se pudieron sincronizar los miembros', {
      err: (err as Error).message,
    });
  }

  for (const channel of SEED_CHANNELS) {
    try {
      await ensureSlugChannel({ tenantId, slug: channel.slug });
    } catch (err) {
      console.warn('[messaging] seed: no se pudo crear el canal', {
        slug: channel.slug,
        err: (err as Error).message,
      });
    }
  }
}
