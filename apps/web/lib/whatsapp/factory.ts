import 'server-only';
import { db } from '@/lib/db/client';
import { whatsappConnections } from '@/lib/db/schema';
import { decrypt } from '@/lib/crypto';
import { and, desc, eq } from 'drizzle-orm';

import { WhatsAppCloudConnector } from './cloud';
import { EvolutionConnector } from './evolution';
import { TwilioConnector } from './twilio';
import { type WhatsAppConnector, WhatsAppConnectorError } from './types';

type WhatsAppConnectionRow = typeof whatsappConnections.$inferSelect;

/**
 * Resuelve el driver correcto para un tenant a partir de `whatsapp_connections`.
 * Lee la fila como app-server (RLS no está activado todavía en esta fase),
 * descifra los tokens y retorna el connector listo para uso.
 *
 * Retorna `null` si el tenant no tiene una conexión CONNECTED. El caller decide
 * cómo comportarse (ej: encolar el mensaje hasta que reconecte).
 */
export async function getConnectorForTenant(tenantId: string): Promise<WhatsAppConnector | null> {
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);

  const conn = rows[0];
  if (!conn) return null;
  return buildConnector(conn);
}

/**
 * Variante para casos donde ya tenemos la fila (ej: webhook handler que
 * resuelve el tenant por phoneId/instanceName).
 */
export function buildConnector(conn: WhatsAppConnectionRow): WhatsAppConnector {
  if (conn.mode === 'CLOUD') {
    if (!conn.phoneId || !conn.cloudAccessTokenEnc || !conn.cloudAppSecretEnc) {
      throw new WhatsAppConnectorError(
        `Tenant ${conn.tenantId} sin credenciales Cloud completas (phoneId/accessToken/appSecret)`,
        'INCOMPLETE_CLOUD_CREDS',
        undefined,
        false,
      );
    }
    return new WhatsAppCloudConnector({
      phoneNumberId: conn.phoneId,
      accessToken: decrypt(conn.cloudAccessTokenEnc),
      appSecret: decrypt(conn.cloudAppSecretEnc),
    });
  }

  if (conn.mode === 'TWILIO') {
    if (!conn.twilioAccountSid || !conn.twilioAuthTokenEnc || !conn.twilioFromNumber) {
      throw new WhatsAppConnectorError(
        `Tenant ${conn.tenantId} sin credenciales Twilio completas (accountSid/authToken/fromNumber)`,
        'INCOMPLETE_TWILIO_CREDS',
        undefined,
        false,
      );
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
    return new TwilioConnector({
      accountSid: conn.twilioAccountSid,
      authToken: decrypt(conn.twilioAuthTokenEnc),
      fromNumber: conn.twilioFromNumber,
      statusCallbackUrl: appUrl
        ? `${appUrl}/api/webhooks/whatsapp/twilio/status`
        : undefined,
    });
  }

  if (conn.mode === 'EVOLUTION') {
    if (!conn.evolutionInstance) {
      throw new WhatsAppConnectorError(
        `Tenant ${conn.tenantId} sin instancia Evolution`,
        'INCOMPLETE_EVOLUTION_CREDS',
        undefined,
        false,
      );
    }
    const baseUrl = process.env.EVOLUTION_API_URL;
    if (!baseUrl) {
      throw new WhatsAppConnectorError(
        'EVOLUTION_API_URL no está configurado',
        'EVOLUTION_BASE_URL_MISSING',
        undefined,
        false,
      );
    }
    // apiKey: token por-instancia si está guardado; si no, la admin key global
    // (AUTHENTICATION_API_KEY), que autoriza todos los endpoints de instancia.
    // Así el envío funciona aunque el token no se haya persistido — p.ej. al
    // reconectar por /instance/connect, que no devuelve el hash.
    const apiKey = conn.evolutionTokenEnc
      ? decrypt(conn.evolutionTokenEnc)
      : process.env.EVOLUTION_API_KEY;
    if (!apiKey) {
      throw new WhatsAppConnectorError(
        `Tenant ${conn.tenantId} sin token Evolution ni EVOLUTION_API_KEY`,
        'INCOMPLETE_EVOLUTION_CREDS',
        undefined,
        false,
      );
    }
    return new EvolutionConnector({
      baseUrl,
      instanceName: conn.evolutionInstance,
      apiKey,
    });
  }

  throw new WhatsAppConnectorError(
    `Mode desconocido: ${String(conn.mode)}`,
    'UNKNOWN_MODE',
    undefined,
    false,
  );
}
