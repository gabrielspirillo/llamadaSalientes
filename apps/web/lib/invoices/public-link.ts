import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Enlace público y caducable al PDF de una factura, para que el proveedor de
 * WhatsApp (Evolution, Cloud, Twilio) lo descargue sin sesión.
 *
 * La firma es un HMAC de (clínica, factura, caducidad) con una clave derivada
 * de `ENCRYPTION_KEY` y separación de dominio, así que no hace falta guardar
 * nada ni una env nueva. Lleva la clínica dentro: un enlace de una factura no
 * sirve para abrir la de otra clínica aunque se cambie el id.
 */

const VERSION = 'v1';

function keyMaterial(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY no está configurada');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY decodificada debe ser 32 bytes');
  return key;
}

export function signInvoiceLink(tenantId: string, invoiceId: string, expiresAtSec: number): string {
  return createHmac('sha256', keyMaterial())
    .update(`invoice-pdf:${VERSION}:${tenantId}:${invoiceId}:${expiresAtSec}`)
    .digest('base64url')
    .slice(0, 43);
}

export function verifyInvoiceLink(
  tenantId: string,
  invoiceId: string,
  expiresAtSec: number,
  signature: string | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signature || !Number.isInteger(expiresAtSec) || expiresAtSec < nowSec) return false;
  const expected = Buffer.from(signInvoiceLink(tenantId, invoiceId, expiresAtSec));
  const got = Buffer.from(signature);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/** Ruta relativa del enlace público (quien llama le antepone la URL de la app). */
export function invoicePublicPath(tenantId: string, invoiceId: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/public/facturas/${invoiceId}?exp=${exp}&sig=${signInvoiceLink(tenantId, invoiceId, exp)}`;
}
