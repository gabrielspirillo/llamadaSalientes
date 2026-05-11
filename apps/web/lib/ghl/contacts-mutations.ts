import 'server-only';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';
import type { GhlContact } from '@/lib/ghl/contacts';

type SearchDuplicateResponse = { contact: GhlContact | null };
type ContactCreateResponse = { contact: GhlContact };

/**
 * Busca un contacto por teléfono en GHL. Devuelve null si no existe.
 * Endpoint: GET /contacts/search/duplicate?locationId=...&number=...
 */
export async function lookupContactByPhone(
  tenantId: string,
  phone: string,
): Promise<GhlContact | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<SearchDuplicateResponse>({
      tenantId,
      path: '/contacts/search/duplicate',
      query: { locationId: integration.locationId, number: phone },
    });
    return data.contact ?? null;
  } catch (err) {
    console.error('[lookupContactByPhone]', err);
    return null;
  }
}

/**
 * Crea un contacto en GHL. Endpoint: POST /contacts/.
 * Si el teléfono ya existe, GHL devuelve 400 con duplicate; en ese caso
 * hacemos lookup y devolvemos el existente.
 */
export async function createContact(
  tenantId: string,
  args: { firstName: string; lastName?: string; phone: string; email?: string },
): Promise<GhlContact | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<ContactCreateResponse>({
      tenantId,
      path: '/contacts/',
      method: 'POST',
      body: {
        locationId: integration.locationId,
        firstName: args.firstName,
        lastName: args.lastName ?? '',
        phone: args.phone,
        ...(args.email ? { email: args.email } : {}),
      },
    });
    return data.contact;
  } catch (err) {
    // Si es duplicate, recuperar el existente
    console.error('[createContact] error, intentando lookup:', err);
    const existing = await lookupContactByPhone(tenantId, args.phone);
    return existing;
  }
}
