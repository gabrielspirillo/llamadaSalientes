import 'server-only';
import { getValidAccessToken } from '@/lib/data/ghl-integration';

const BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export class GhlApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`GHL ${status} ${path}: ${body.slice(0, 200)}`);
    this.name = 'GhlApiError';
  }
}

export type GhlRequest = {
  tenantId: string;
  path: string; // e.g. '/contacts/search'
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export async function ghlFetch<T = unknown>({
  tenantId,
  path,
  method = 'GET',
  query,
  body,
}: GhlRequest): Promise<T> {
  const token = await getValidAccessToken(tenantId);

  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new GhlApiError(res.status, path, text);
  }

  // Endpoints DELETE devuelven 204 sin body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
