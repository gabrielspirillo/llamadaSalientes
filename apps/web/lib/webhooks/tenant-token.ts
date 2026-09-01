import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token por tenant para webhooks de proveedores que NO firman sus envíos
 * (GoHighLevel, Evolution API).
 *
 * Sin esto el único "auth" era el identificador que manda el propio emisor
 * (`locationId` de GHL, `instance` de Evolution), ambos adivinables: cualquiera
 * podía inyectar eventos y hacer que el sistema llamara por teléfono o mandara
 * WhatsApp a pacientes reales con el saldo de la clínica.
 *
 * El token se deriva de `ENCRYPTION_KEY` (ya obligatoria y de 32 bytes) con
 * separación de dominio por `scope`, así que no hace falta una env nueva ni
 * guardar nada en BD: es determinístico y se puede regenerar para mostrarlo en
 * la URL que el operador configura en el proveedor.
 */

const VERSION = 'v1';

function keyMaterial(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY no está configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY decodificada debe ser 32 bytes (es ${key.length})`);
  }
  return key;
}

export type WebhookScope = 'ghl' | 'evolution';

/** Token estable para (scope, tenant). 32 chars base64url. */
export function webhookToken(scope: WebhookScope, tenantId: string): string {
  return createHmac('sha256', keyMaterial())
    .update(`webhook-token:${VERSION}:${scope}:${tenantId}`)
    .digest('base64url')
    .slice(0, 32);
}

/** Comparación en tiempo constante. `received` puede venir null/undefined. */
export function verifyWebhookToken(
  scope: WebhookScope,
  tenantId: string,
  received: string | null | undefined,
): boolean {
  if (!received) return false;
  const expected = Buffer.from(webhookToken(scope, tenantId));
  const got = Buffer.from(received);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/**
 * Lee el token de la request. Se acepta por query (`?token=`) porque es la
 * única vía que ofrecen estos proveedores, y por header para quien pueda
 * mandarlo sin dejarlo en los logs del proxy.
 */
export function readWebhookToken(req: {
  headers: { get(name: string): string | null };
  nextUrl: { searchParams: URLSearchParams };
}): string | null {
  return req.headers.get('x-webhook-token') ?? req.nextUrl.searchParams.get('token');
}

/**
 * URL completa que hay que pegar en GHL (Settings → Integrations → Webhooks).
 * Se loguea al rechazar un envío para que el operador vea exactamente qué
 * configurar sin tener que correr un script.
 */
export function ghlWebhookUrlFor(
  tenantId: string,
  kind: 'contact' | 'appointment',
  locationId: string,
): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const token = webhookToken('ghl', tenantId);
  return `${base}/api/webhooks/ghl/${kind}?location=${encodeURIComponent(locationId)}&token=${token}`;
}
