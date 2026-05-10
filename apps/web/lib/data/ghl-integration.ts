import 'server-only';
import { decrypt, encrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { ghlIntegrations } from '@/lib/db/schema';
import type { GhlTokenResponse } from '@/lib/ghl/oauth';
import { refreshAccessToken } from '@/lib/ghl/oauth';
import { eq } from 'drizzle-orm';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresca si quedan < 5 min

// Sentinel: distingue Private Integration Tokens (PIT) de tokens OAuth.
// PIT no expira y no tiene refresh — guardamos este string en refreshTokenEnc
// (cifrado igualmente) y skipeamos el refresh flow.
const PIT_MARKER = '__PIT_NO_REFRESH__';

export type GhlIntegration = typeof ghlIntegrations.$inferSelect;

export async function getGhlIntegration(tenantId: string) {
  const rows = await db
    .select()
    .from(ghlIntegrations)
    .where(eq(ghlIntegrations.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertGhlIntegration(input: {
  tenantId: string;
  tokens: GhlTokenResponse;
  connectedBy?: string | null;
}) {
  const expiresAt = new Date(Date.now() + input.tokens.expires_in * 1000);
  const values = {
    tenantId: input.tenantId,
    locationId: input.tokens.locationId ?? '',
    companyId: input.tokens.companyId ?? null,
    accessTokenEnc: encrypt(input.tokens.access_token),
    refreshTokenEnc: encrypt(input.tokens.refresh_token),
    expiresAt,
    scopes: input.tokens.scope,
    connectedBy: input.connectedBy ?? null,
  };

  const existing = await getGhlIntegration(input.tenantId);
  if (existing) {
    const [row] = await db
      .update(ghlIntegrations)
      .set(values)
      .where(eq(ghlIntegrations.tenantId, input.tenantId))
      .returning();
    return row;
  }
  const [row] = await db.insert(ghlIntegrations).values(values).returning();
  return row;
}

export async function deleteGhlIntegration(tenantId: string) {
  await db.delete(ghlIntegrations).where(eq(ghlIntegrations.tenantId, tenantId));
}

/**
 * Conecta GHL via Private Integration Token (alternativa a OAuth).
 * Más simple: el token no expira y no tiene refresh.
 */
export async function upsertGhlPit(input: {
  tenantId: string;
  pit: string;
  locationId: string;
  companyId?: string | null;
  scopes?: string;
  connectedBy?: string | null;
}) {
  if (!input.pit.startsWith('pit-')) {
    throw new Error('El token no parece ser un PIT válido (debe empezar con "pit-")');
  }

  const values = {
    tenantId: input.tenantId,
    locationId: input.locationId,
    companyId: input.companyId ?? null,
    accessTokenEnc: encrypt(input.pit),
    refreshTokenEnc: encrypt(PIT_MARKER),
    expiresAt: new Date('2099-12-31T00:00:00Z'),
    scopes: input.scopes ?? 'pit',
    connectedBy: input.connectedBy ?? null,
  };

  const existing = await getGhlIntegration(input.tenantId);
  if (existing) {
    const [row] = await db
      .update(ghlIntegrations)
      .set(values)
      .where(eq(ghlIntegrations.tenantId, input.tenantId))
      .returning();
    return row;
  }
  const [row] = await db.insert(ghlIntegrations).values(values).returning();
  return row;
}

export function isPitIntegration(integration: GhlIntegration): boolean {
  try {
    return decrypt(integration.refreshTokenEnc) === PIT_MARKER;
  } catch {
    return false;
  }
}

/**
 * Devuelve un access token válido.
 *  - PIT: lo desencripta y devuelve directo (no expira).
 *  - OAuth: refresca si está por expirar y persiste los nuevos tokens.
 */
export async function getValidAccessToken(tenantId: string): Promise<string> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) {
    throw new Error('GHL no está conectado para este tenant');
  }

  // PIT: token estático, no hay refresh.
  if (isPitIntegration(integration)) {
    return decrypt(integration.accessTokenEnc);
  }

  const now = Date.now();
  const expires = integration.expiresAt.getTime();

  if (expires - now > REFRESH_BUFFER_MS) {
    return decrypt(integration.accessTokenEnc);
  }

  // Refresh OAuth
  const refreshToken = decrypt(integration.refreshTokenEnc);
  const fresh = await refreshAccessToken(refreshToken);

  await upsertGhlIntegration({
    tenantId,
    tokens: fresh,
    connectedBy: integration.connectedBy,
  });

  return fresh.access_token;
}
