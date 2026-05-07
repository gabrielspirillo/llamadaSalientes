import 'server-only';
import { decrypt, encrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { ghlIntegrations } from '@/lib/db/schema';
import type { GhlTokenResponse } from '@/lib/ghl/oauth';
import { refreshAccessToken } from '@/lib/ghl/oauth';
import { eq } from 'drizzle-orm';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresca si quedan < 5 min

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
 * Devuelve un access token válido. Si está por expirar, lo refresca y persiste
 * los nuevos tokens cifrados antes de devolver.
 */
export async function getValidAccessToken(tenantId: string): Promise<string> {
  const integration = await getGhlIntegration(tenantId);
  if (!integration) {
    throw new Error('GHL no está conectado para este tenant');
  }

  const now = Date.now();
  const expires = integration.expiresAt.getTime();

  if (expires - now > REFRESH_BUFFER_MS) {
    return decrypt(integration.accessTokenEnc);
  }

  // Refresh
  const refreshToken = decrypt(integration.refreshTokenEnc);
  const fresh = await refreshAccessToken(refreshToken);

  await upsertGhlIntegration({
    tenantId,
    tokens: fresh,
    connectedBy: integration.connectedBy,
  });

  return fresh.access_token;
}
