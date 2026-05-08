import { verify as retellVerify, sign as retellSign } from 'retell-sdk';

/**
 * Verifica la firma de Retell. El SDK firma con formato `v=<ts>,d=<digest>`
 * usando la **API key** como secreto (HMAC-SHA256 sobre body+timestamp).
 * Incluye protección anti-replay de 5 min built-in.
 */
export async function verifyRetellSignature(
  rawBody: Buffer,
  signature: string | null,
  apiKey: string,
): Promise<boolean> {
  if (!signature || !apiKey) return false;
  try {
    return await retellVerify(rawBody.toString('utf8'), apiKey, signature);
  } catch {
    return false;
  }
}

// Re-export para tests (se usa para generar firmas válidas en fixtures)
export { retellSign };
