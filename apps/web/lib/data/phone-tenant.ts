import 'server-only';
import { isUuid } from '@/lib/agenda/appointment-ref';
import { db } from '@/lib/db/client';
import { phoneNumbers, tenantTelephony } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Resolución de tenant para llamadas de Retell:
 *   1. Si la metadata trae tenant_id (outbound calls), úsalo.
 *   2. Caso contrario (inbound), busca por el número de destino (to_number)
 *      en la tabla phone_numbers — único índice cross-tenant.
 *   3. Si no está, en `tenant_telephony.inbound_number_e164`: los números de
 *      Zadarma (el SIP trunk cargado en Retell) no viven en phone_numbers.
 *   4. Si nada matchea, retorna null y el caller responde 400.
 */
export async function resolveTenantId(args: {
  metadataTenantId?: string | null;
  toNumber?: string | null;
}): Promise<string | null> {
  if (args.metadataTenantId) return isUuid(args.metadataTenantId) ? args.metadataTenantId : null;
  if (!args.toNumber) return null;

  const rows = await db
    .select({ tenantId: phoneNumbers.tenantId })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.e164, args.toNumber))
    .limit(1);

  if (rows[0]) return rows[0].tenantId;

  const zadarma = await db
    .select({ tenantId: tenantTelephony.tenantId })
    .from(tenantTelephony)
    .where(eq(tenantTelephony.inboundNumberE164, args.toNumber))
    .limit(1);
  return zadarma[0]?.tenantId ?? null;
}
