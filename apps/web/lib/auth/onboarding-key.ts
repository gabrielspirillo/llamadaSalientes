import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token per-tenant para autorizar el submit del wizard de onboarding público
 * (POST /api/public/onboarding). Mismo enfoque que lib/auth/intake-key.ts:
 * derivado determinísticamente de ENCRYPTION_KEY + tenantId, sin tabla nueva.
 *
 * Se usa un namespace distinto ("onboarding:") para que el link de onboarding
 * NO comparta secreto con la intake key de leads: comprometer/rotar uno no
 * expone al otro.
 *
 * El operador arma el link que le manda a cada clínica:
 *   https://app.futuradigital.es/onboarding/clinica?tenant=<slug>&key=<key>
 *
 * Para revocar todos los links: rotar ENCRYPTION_KEY.
 *
 * Formato: HMAC-SHA256("onboarding:{tenantId}", ENCRYPTION_KEY) → hex.
 */
export function deriveOnboardingKey(tenantId: string): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY no está configurada');
  return createHmac('sha256', secret).update(`onboarding:${tenantId}`).digest('hex');
}

export function verifyOnboardingKey(tenantId: string, providedKey: string | null): boolean {
  if (!providedKey) return false;
  try {
    const expected = deriveOnboardingKey(tenantId);
    if (expected.length !== providedKey.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(providedKey));
  } catch {
    return false;
  }
}
