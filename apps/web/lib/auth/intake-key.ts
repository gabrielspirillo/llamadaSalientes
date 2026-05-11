import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * API key per-tenant para autenticar leads entrantes en /api/leads/intake.
 * Derivada determinísticamente desde ENCRYPTION_KEY + tenantId — no requiere
 * tabla nueva. Para revocar, rotar ENCRYPTION_KEY (impacta a todos los tenants).
 *
 * Formato: HMAC-SHA256("intake:{tenantId}", ENCRYPTION_KEY) → hex.
 */
export function deriveIntakeKey(tenantId: string): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY no está configurada');
  return createHmac('sha256', secret).update(`intake:${tenantId}`).digest('hex');
}

export function verifyIntakeKey(tenantId: string, providedKey: string | null): boolean {
  if (!providedKey) return false;
  try {
    const expected = deriveIntakeKey(tenantId);
    if (expected.length !== providedKey.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(providedKey));
  } catch {
    return false;
  }
}
