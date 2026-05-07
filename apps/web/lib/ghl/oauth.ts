import 'server-only';
import { env } from '@/lib/env';

// GoHighLevel OAuth 2.0 — based on https://highlevel.stoplight.io/docs/integrations
// Authorize endpoint:  https://marketplace.gohighlevel.com/oauth/chooselocation
// Token endpoint:      https://services.leadconnectorhq.com/oauth/token

const AUTHORIZE_URL = 'https://marketplace.gohighlevel.com/oauth/chooselocation';
const TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

export const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'calendars.readonly',
  'calendars/events.readonly',
  'calendars/events.write',
  'locations.readonly',
  'users.readonly',
] as const;

export type GhlTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds
  scope: string;
  userType: 'Location' | 'Company';
  locationId?: string;
  companyId?: string;
  userId?: string;
};

export function buildAuthorizeUrl(state: string): string {
  const clientId = requireGhlConfig('GHL_CLIENT_ID', env.GHL_CLIENT_ID);
  const redirectUri = requireGhlConfig('GHL_REDIRECT_URI', env.GHL_REDIRECT_URI);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GHL_SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<GhlTokenResponse> {
  const clientId = requireGhlConfig('GHL_CLIENT_ID', env.GHL_CLIENT_ID);
  const clientSecret = requireGhlConfig('GHL_CLIENT_SECRET', env.GHL_CLIENT_SECRET);
  const redirectUri = requireGhlConfig('GHL_REDIRECT_URI', env.GHL_REDIRECT_URI);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    user_type: 'Location',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GhlTokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<GhlTokenResponse> {
  const clientId = requireGhlConfig('GHL_CLIENT_ID', env.GHL_CLIENT_ID);
  const clientSecret = requireGhlConfig('GHL_CLIENT_SECRET', env.GHL_CLIENT_SECRET);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    user_type: 'Location',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL token refresh failed (${res.status}): ${text}`);
  }
  return (await res.json()) as GhlTokenResponse;
}

function requireGhlConfig(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} no está configurada. Conectá GHL Marketplace primero (ver README sección Fase 3).`,
    );
  }
  return value;
}
