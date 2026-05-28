import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappContacts } from '@/lib/db/schema';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

// Type guard para los connectors que sí saben fetchear la foto de perfil.
// Hoy solo Evolution lo implementa; Cloud y Twilio no exponen API pública
// para profile pictures.
function supportsProfilePicture(
  connector: WhatsAppConnector,
): connector is WhatsAppConnector & {
  fetchProfilePictureUrl(toE164: string): Promise<string | null>;
} {
  return typeof (connector as { fetchProfilePictureUrl?: unknown }).fetchProfilePictureUrl ===
    'function';
}

/**
 * Asegura que el whatsapp_contact tenga avatar_url. Idempotente:
 *   - Si ya hay avatar_url, sale.
 *   - Si el connector no soporta fetchProfilePictureUrl (Cloud/Twilio), sale.
 *   - Si el endpoint devuelve null (privacy del contacto), sale.
 *
 * No tira nunca: best-effort. La UI ya tiene fallback a iniciales.
 */
export async function syncWhatsappContactAvatar(input: {
  contactId: string;
  phoneE164: string;
  connector: WhatsAppConnector | null;
}): Promise<{ avatarUrl: string | null }> {
  try {
    const rows = await db
      .select({ avatarUrl: whatsappContacts.avatarUrl })
      .from(whatsappContacts)
      .where(eq(whatsappContacts.id, input.contactId))
      .limit(1);
    const current = rows[0];
    if (!current) return { avatarUrl: null };
    if (current.avatarUrl) return { avatarUrl: current.avatarUrl };

    if (!input.connector || !supportsProfilePicture(input.connector)) {
      return { avatarUrl: null };
    }

    const url = await input.connector.fetchProfilePictureUrl(input.phoneE164);
    if (!url) return { avatarUrl: null };

    await db
      .update(whatsappContacts)
      .set({ avatarUrl: url, updatedAt: new Date() })
      .where(eq(whatsappContacts.id, input.contactId));
    return { avatarUrl: url };
  } catch (err) {
    console.warn('[wa-avatar-sync] failed', {
      contactId: input.contactId,
      err: (err as Error).message,
    });
    return { avatarUrl: null };
  }
}
