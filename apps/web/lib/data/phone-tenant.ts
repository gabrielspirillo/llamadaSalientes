import 'server-only';
import { db } from '@/lib/db/client';
import { phoneNumbers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Resolución de tenant para llamadas de Retell:
 *   1. Si la metadata trae tenant_id (outbound calls), úsalo.
 *   2. Caso contrario (inbound), busca por el número de destino (to_number)
 *      en la tabla phone_numbers — único índice cross-tenant.
 *   3. Si nada matchea, retorna null y el caller responde 400.
 */
export async function resolveTenantId(args: {
  metadataTenantId?: string | null;
  toNumber?: string | null;
}): Promise<string | null> {
  if (args.metadataTenantId) return args.metadataTenantId;
  if (!args.toNumber) return null;

  const rows = await db
    .select({ tenantId: phoneNumbers.tenantId })
    .from(phoneNumbers)
    .where(eq(phoneNumbers.e164, args.toNumber))
    .limit(1);

  return rows[0]?.tenantId ?? null;
}
