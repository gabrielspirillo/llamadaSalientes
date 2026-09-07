import { z } from 'zod';

/**
 * Marca por clínica (white-label).
 *
 * El panel se dibujaba siempre con la marca "FUTURA" escrita a mano en el
 * sidebar y en el topbar. Con esto cada clínica puede tener su nombre y su
 * logo, y quien entra a esa clínica los ve en todo el panel. Sólo Futura
 * (super-admin) los cambia: es parte de dar de alta y mantener a un cliente,
 * no un ajuste que la clínica se toca sola.
 *
 * Este módulo NO es `server-only` a propósito: el diálogo del panel Futura es
 * un componente cliente y necesita las mismas reglas (tipos permitidos, tamaño
 * máximo, longitud del nombre) para avisar antes de subir nada. Las reglas se
 * vuelven a comprobar en el servidor, que es donde mandan.
 */

/** Lo que necesita el panel para pintarse con la marca de una clínica. */
export type Branding = {
  /** Nombre de la clínica. Nunca vacío: cae al nombre del tenant. */
  name: string;
  /** URL pública del logo, o null si la clínica no tiene uno propio. */
  logoUrl: string | null;
};

/**
 * Allowlist explícita de formatos de logo. Nada de `image/*` ni de SVG: un SVG
 * es HTML ejecutable y este archivo se sirve desde un bucket público y se pinta
 * dentro del panel. Un logo no necesita scripts.
 */
export const ALLOWED_LOGO_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
]);

export const LOGO_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
};

/** 2 MB. Un logo que pesa más está mal exportado, no es un logo grande. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Etiqueta legible de los formatos aceptados, para los mensajes de error. */
export const ALLOWED_LOGO_LABEL = 'PNG, JPG, WEBP, AVIF o GIF';

/** El `accept` del <input type="file">. Sirve de filtro, no de validación. */
export const LOGO_ACCEPT = [...ALLOWED_LOGO_MIMES].join(',');

/**
 * Nombre de la clínica. Se recorta antes de validar para que " " no pase por
 * "un carácter", y se colapsan los espacios interiores: el nombre viaja a Clerk
 * y aparece en el selector de organizaciones, donde un doble espacio canta.
 */
export const clinicNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'El nombre debe tener al menos 2 caracteres.')
      .max(80, 'El nombre no puede pasar de 80 caracteres.'),
  );

/**
 * Key del logo dentro del bucket.
 *
 * Lleva un UUID en vez de un nombre fijo por clínica a propósito: el objeto se
 * sirve con `Cache-Control: max-age=3600`, así que reescribir la misma key
 * dejaría el logo viejo en el navegador hasta una hora después del cambio. Con
 * una key nueva la URL cambia y el logo nuevo se ve al instante; el anterior se
 * borra por `logo_path`.
 */
export function buildLogoPath(tenantId: string, mime: string): string {
  const ext = LOGO_EXT_BY_MIME[mime] ?? 'bin';
  return `tenants/${tenantId}/branding/${crypto.randomUUID()}.${ext}`;
}

/**
 * Normaliza el mime que manda el navegador: puede venir como
 * `image/png; charset=binary`.
 */
export function normalizeMime(raw: string): string {
  const value = raw || 'application/octet-stream';
  return (value.split(';')[0] ?? value).trim().toLowerCase();
}
