import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

/**
 * Firma de requests Zadarma API:
 *   Authorization: <user_key>:<base64( HMAC-SHA1-hex(secret, method + paramsString + md5(paramsString)) )>
 *
 * Donde:
 *   - `method`: path absoluto del endpoint, ej. "/v1/info/balance/"
 *      (con slashes de inicio/fin tal cual los documenta Zadarma).
 *   - `paramsString`: pares clave=valor ordenados alfabéticamente por clave,
 *      unidos por "&". URL-encoding usa el formato estándar
 *      (application/x-www-form-urlencoded). Los valores undefined/null se
 *      omiten. Para requests sin params, paramsString = "".
 *   - HMAC-SHA1 se aplica al string `method + paramsString + md5(paramsString)`
 *      donde el md5 viene en hex lowercase. El resultado del HMAC se toma
 *      en hex y SE PASA A base64 (sí, esto es raro — está así en los docs).
 *
 * Referencia: https://zadarma.com/en/support/api/ → "Authorization Method"
 */
export function buildZadarmaSignature(
  method: string,
  params: Record<string, string | number | boolean | undefined | null>,
  userKey: string,
  secret: string,
): { authorization: string; paramsString: string } {
  const paramsString = buildSortedParamsString(params);
  const md5 = createHash('md5').update(paramsString).digest('hex');
  const data = `${method}${paramsString}${md5}`;
  const hmacHex = createHmac('sha1', secret).update(data).digest('hex');
  const signature = Buffer.from(hmacHex, 'utf8').toString('base64');
  return {
    authorization: `${userKey}:${signature}`,
    paramsString,
  };
}

/**
 * Serializa los params en el formato exacto que espera el algoritmo de firma
 * de Zadarma: claves ordenadas alfabéticamente, encoding x-www-form-urlencoded.
 * Filtra null/undefined; convierte booleans a 'true'/'false'.
 */
export function buildSortedParamsString(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const usp = new URLSearchParams();
  const keys = Object.keys(params).sort();
  for (const k of keys) {
    const v = params[k];
    if (v === undefined || v === null) continue;
    usp.append(k, typeof v === 'boolean' ? String(v) : String(v));
  }
  return usp.toString();
}

/**
 * Verifica la firma de un webhook NOTIFY_* de Zadarma.
 *
 * Cada evento Zadarma compone la firma de forma distinta concatenando ciertos
 * campos del payload + el api_secret (o webhook_secret si está configurado),
 * y devolviendo `base64( md5( <fields_concat> ) )` en el campo `signature`
 * del body.
 *
 * Ejemplo NOTIFY_START:
 *   signature = base64( md5( call_start + caller_id + called_did + secret ) )
 *
 * Por la heterogeneidad de los eventos, este helper es genérico: recibe los
 * fields ya concatenados en el orden correcto + el secret + la firma a
 * comparar, y hace la verificación en tiempo constante.
 */
export function verifyZadarmaWebhookSignature(
  fieldsConcatenated: string,
  secret: string,
  receivedSignature: string,
): boolean {
  const expectedB64 = Buffer.from(
    createHash('md5').update(`${fieldsConcatenated}${secret}`).digest('hex'),
    'utf8',
  ).toString('base64');

  const a = Buffer.from(expectedB64);
  const b = Buffer.from(receivedSignature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
