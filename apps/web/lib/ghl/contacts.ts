import 'server-only';
import { getGhlIntegration } from '@/lib/data/ghl-integration';
import { ghlFetch } from '@/lib/ghl/client';

export type GhlContact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullNameLowerCase?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  tags?: string[] | null;
  type?: string | null;
  dateAdded?: string | null;
  dateUpdated?: string | null;
  lastActivity?: string | null;
  source?: string | null;
};

type ListResponse = {
  contacts?: GhlContact[];
  meta?: { total?: number; nextPageUrl?: string | null; currentPage?: number };
};

export type ListContactsOptions = {
  query?: string;
  limit?: number;
  page?: number;
};

/**
 * Lista contactos del location del tenant.
 * GHL endpoint: GET /contacts/?locationId=...&query=...&limit=...&page=...
 */
export async function listContacts(
  tenantId: string,
  opts: ListContactsOptions = {},
): Promise<{ contacts: GhlContact[]; total: number }> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return { contacts: [], total: 0 };

  const limit = Math.min(opts.limit ?? 50, 100);

  try {
    const data = await ghlFetch<ListResponse>({
      tenantId,
      path: '/contacts/',
      query: {
        locationId: integration.locationId,
        ...(opts.query ? { query: opts.query } : {}),
        limit,
        page: opts.page ?? 1,
      },
    });
    return {
      contacts: data.contacts ?? [],
      total: data.meta?.total ?? data.contacts?.length ?? 0,
    };
  } catch (err) {
    console.error('[listContacts]', err);
    return { contacts: [], total: 0 };
  }
}

export async function getContact(tenantId: string, contactId: string): Promise<GhlContact | null> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) return null;
  try {
    const data = await ghlFetch<{ contact?: GhlContact }>({
      tenantId,
      path: `/contacts/${contactId}`,
    });
    return data.contact ?? null;
  } catch (err) {
    console.error('[getContact]', err);
    return null;
  }
}

export function fullName(c: GhlContact): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  if (c.email) return c.email;
  if (c.phone) return c.phone;
  return 'Sin nombre';
}

export function initials(c: GhlContact): string {
  const f = (c.firstName ?? '').trim();
  const l = (c.lastName ?? '').trim();
  if (f || l) return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase() || '·';
  if (c.email) return c.email[0]?.toUpperCase() ?? '·';
  return '·';
}

// Paleta de gradients para avatars (determinista por contactId)
const AVATAR_GRADIENTS = [
  'from-violet-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-red-500',
  'from-indigo-500 to-purple-500',
  'from-sky-500 to-blue-500',
  'from-fuchsia-500 to-pink-500',
];

export function avatarGradient(c: GhlContact): string {
  let hash = 0;
  for (const ch of c.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]!;
}
