import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica la firma HMAC-SHA256 que Retell incluye en el header x-retell-signature.
 * Usa comparación en tiempo constante para prevenir timing attacks.
 */
export function verifyRetellSignature(
  rawBody: Buffer,
  signature: string | null,
  signingKey: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
