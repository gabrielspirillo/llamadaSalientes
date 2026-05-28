import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappContacts } from '@/lib/db/schema';

/**
 * Sincroniza un whatsapp_contact con GHL (CRM externo).
 *
 *  1. Si el contact local ya tiene ghl_contact_id, sale (idempotente).
 *  2. Busca por teléfono en GHL via /contacts/search/duplicate.
 *  3. Si no existe en GHL, lo crea via POST /contacts/.
 *  4. Actualiza whatsapp_contacts.ghl_contact_id con el id resuelto, y
 *     pisa `name` solo si estaba null (preserva ediciones del operador).
 *
 * Failure-mode: si GHL no está conectado (sin integration), si la API
 * falla, o si lookup/create devuelven null, esta función NO tira excepción
 * — loguea warn y devuelve null. El siguiente inbound del mismo contacto
 * reintenta naturalmente.
 */
export async function syncWhatsappContactWithGhl(
  tenantId: string,
  contactId: string,
): Promise<{ ghlContactId: string; created: boolean } | null> {
  try {
    const rows = await db
      .select()
      .from(whatsappContacts)
      .where(eq(whatsappContacts.id, contactId))
      .limit(1);
    const contact = rows[0];
    if (!contact) return null;
    if (contact.ghlContactId) {
      return { ghlContactId: contact.ghlContactId, created: false };
    }

    // Dynamic import: los helpers de GHL importan transitive `env.ts` que
    // valida con zod al cargar el módulo. Lo postergamos a runtime para que
    // tests que mockean este archivo no exploten por env vars faltantes.
    const { createContact, lookupContactByPhone } = await import(
      '@/lib/ghl/contacts-mutations'
    );

    // 1. Buscar match por teléfono.
    let ghlContact = await lookupContactByPhone(tenantId, contact.phoneE164);
    let created = false;

    // 2. No existe → crear en GHL.
    if (!ghlContact) {
      const { firstName, lastName } = splitName(contact.name, contact.phoneE164);
      ghlContact = await createContact(tenantId, {
        firstName,
        lastName,
        phone: contact.phoneE164,
      });
      if (ghlContact) created = true;
    }

    // Si no hay integración GHL o la API falló del todo, salimos sin escribir.
    if (!ghlContact) return null;

    const ghlName = composeName(ghlContact.firstName, ghlContact.lastName);
    await db
      .update(whatsappContacts)
      .set({
        ghlContactId: ghlContact.id,
        // Solo rellenar `name` si estaba vacío: respeta una edición previa
        // del operador, igual que el upsert de persist.ts.
        ...(contact.name == null && ghlName ? { name: ghlName } : {}),
        updatedAt: new Date(),
      })
      .where(eq(whatsappContacts.id, contactId));

    // Primera vez que linkeamos: hidratar appointments_cache con las citas
    // existentes en GHL para este contacto. Best-effort, no rompe el sync.
    // El webhook AppointmentCreate/Update va a mantener el cache fresh de
    // ahora en adelante.
    await hydrateAppointmentsForContact(tenantId, ghlContact.id).catch((err) => {
      console.warn('[wa-ghl-sync] hydrate appointments failed', {
        tenantId,
        contactId,
        ghlContactId: ghlContact!.id,
        err: (err as Error).message,
      });
    });

    return { ghlContactId: ghlContact.id, created };
  } catch (err) {
    console.warn('[wa-ghl-sync] failed', {
      tenantId,
      contactId,
      err: (err as Error).message,
    });
    return null;
  }
}

// Si `name` ya viene como "Juan Pérez" partimos por whitespace. Si no hay
// nombre usamos un placeholder con el phone — GHL exige firstName no vacío
// al crear.
function splitName(
  name: string | null,
  phoneE164: string,
): { firstName: string; lastName: string } {
  if (!name) return { firstName: `WhatsApp ${phoneE164}`, lastName: '' };
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (!first) return { firstName: `WhatsApp ${phoneE164}`, lastName: '' };
  return { firstName: first, lastName: parts.slice(1).join(' ') };
}

function composeName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  // No queremos pisar `name` con un placeholder feo si GHL devuelve nuestro
  // propio "WhatsApp <phone>" — lo dejamos null en ese caso.
  if (f.startsWith('WhatsApp +')) return null;
  const joined = [f, l].filter(Boolean).join(' ');
  return joined || null;
}

async function hydrateAppointmentsForContact(
  tenantId: string,
  ghlContactId: string,
): Promise<void> {
  // Dynamic imports por la misma razón que arriba: evitar arrastrar env.ts
  // en módulos cargados desde tests.
  const [{ listAppointmentsForContact }, { upsertAppointmentCacheMany }] =
    await Promise.all([
      import('@/lib/ghl/appointments'),
      import('@/lib/appointments/cache'),
    ]);
  const appts = await listAppointmentsForContact(tenantId, ghlContactId);
  if (appts.length === 0) return;
  await upsertAppointmentCacheMany({ tenantId, appts });
}
