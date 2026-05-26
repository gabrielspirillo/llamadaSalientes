import 'server-only';
import { decrypt, encrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { tenantTelephony } from '@/lib/db/schema';
import type { TelephonyProvider } from '@/lib/telephony/provider';
import { TwilioRestClient } from '@/lib/twilio/client';
import { ZadarmaRestClient } from '@/lib/zadarma/client';
import { eq } from 'drizzle-orm';

export type TenantTelephony = typeof tenantTelephony.$inferSelect;

export async function getTenantTelephony(tenantId: string): Promise<TenantTelephony | null> {
  const rows = await db
    .select()
    .from(tenantTelephony)
    .where(eq(tenantTelephony.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

/** Lookup público (sin auth) para el webhook inbound: To E.164 → tenantId. */
export async function findTenantByInboundNumber(toE164: string): Promise<TenantTelephony | null> {
  const rows = await db
    .select()
    .from(tenantTelephony)
    .where(eq(tenantTelephony.inboundNumberE164, toE164))
    .limit(1);
  return rows[0] ?? null;
}

/** Upsert genérico — usa el patrón set-or-insert ya que la PK es tenantId. */
export async function upsertTenantTelephony(
  tenantId: string,
  patch: Partial<typeof tenantTelephony.$inferInsert>,
): Promise<TenantTelephony> {
  const existing = await getTenantTelephony(tenantId);
  if (existing) {
    const [row] = await db
      .update(tenantTelephony)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(tenantTelephony.tenantId, tenantId))
      .returning();
    if (!row) throw new Error('No se pudo actualizar tenant_telephony');
    return row;
  }
  const [row] = await db
    .insert(tenantTelephony)
    .values({ tenantId, ...patch })
    .returning();
  if (!row) throw new Error('No se pudo crear tenant_telephony');
  return row;
}

export async function saveTwilioCredentials(
  tenantId: string,
  accountSid: string,
  authToken: string,
): Promise<TenantTelephony> {
  return upsertTenantTelephony(tenantId, {
    provider: 'twilio',
    twilioAccountSid: accountSid,
    twilioAuthTokenEnc: encrypt(authToken),
  });
}

export async function saveZadarmaCredentials(
  tenantId: string,
  userKey: string,
  secret: string,
  webhookSecret?: string | null,
): Promise<TenantTelephony> {
  return upsertTenantTelephony(tenantId, {
    provider: 'zadarma',
    zadarmaUserKey: userKey,
    zadarmaSecretEnc: encrypt(secret),
    zadarmaWebhookSecretEnc: webhookSecret ? encrypt(webhookSecret) : null,
  });
}

/**
 * Devuelve un cliente Twilio listo para usar para el tenant. Lanza si no hay
 * credenciales cargadas. Decifra el auth token a memoria sólo durante la
 * vida del request.
 */
export async function getTwilioClientFor(tenantId: string): Promise<{
  client: TwilioRestClient;
  telephony: TenantTelephony;
}> {
  const telephony = await getTenantTelephony(tenantId);
  if (!telephony?.twilioAccountSid || !telephony.twilioAuthTokenEnc) {
    throw new Error(
      'Este tenant todavía no cargó credenciales Twilio. Configurá Account SID + Auth Token en Configuración → Telefonía.',
    );
  }
  const authToken = decrypt(telephony.twilioAuthTokenEnc);
  return {
    client: new TwilioRestClient({
      accountSid: telephony.twilioAccountSid,
      authToken,
    }),
    telephony,
  };
}

/**
 * Devuelve un cliente Zadarma listo para usar para el tenant. Lanza si no
 * hay credenciales cargadas o el provider activo no es Zadarma.
 */
export async function getZadarmaClientFor(tenantId: string): Promise<{
  client: ZadarmaRestClient;
  telephony: TenantTelephony;
}> {
  const telephony = await getTenantTelephony(tenantId);
  if (!telephony?.zadarmaUserKey || !telephony.zadarmaSecretEnc) {
    throw new Error(
      'Este tenant todavía no cargó credenciales Zadarma. Configurá User Key + Secret en Configuración → Telefonía.',
    );
  }
  const secret = decrypt(telephony.zadarmaSecretEnc);
  return {
    client: new ZadarmaRestClient({
      userKey: telephony.zadarmaUserKey,
      secret,
    }),
    telephony,
  };
}

/**
 * Devuelve el secret de verificación de webhooks Zadarma del tenant
 * (descifrado). Si no hay webhook secret configurado, cae al api secret
 * (Zadarma usa el mismo para varios eventos cuando no se configura uno
 * separado en el cabinet). Null si no hay credenciales en absoluto.
 */
export async function getZadarmaWebhookSecretFor(tenantId: string): Promise<string | null> {
  const t = await getTenantTelephony(tenantId);
  if (!t) return null;
  if (t.zadarmaWebhookSecretEnc) return decrypt(t.zadarmaWebhookSecretEnc);
  if (t.zadarmaSecretEnc) return decrypt(t.zadarmaSecretEnc);
  return null;
}

/**
 * Devuelve el provider activo del tenant. Si no hay row, asume 'twilio'
 * (compat hacia atrás con tenants pre-migración 0010).
 */
export async function getTelephonyProvider(tenantId: string): Promise<TelephonyProvider> {
  const t = await getTenantTelephony(tenantId);
  return (t?.provider as TelephonyProvider | undefined) ?? 'twilio';
}
