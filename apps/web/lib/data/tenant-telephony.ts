import 'server-only';
import { decrypt, encrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { tenantTelephony } from '@/lib/db/schema';
import { TwilioRestClient } from '@/lib/twilio/client';
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
    twilioAccountSid: accountSid,
    twilioAuthTokenEnc: encrypt(authToken),
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
