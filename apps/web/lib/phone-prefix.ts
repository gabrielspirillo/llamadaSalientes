// Prefijo telefónico por defecto de una clínica, sacado de su timezone. Puro.
//
// Recepción teclea los nueve dígitos del móvil ("646 55 66 19") y el campo ya
// lleva el prefijo del país de la clínica. No se fija "+34" en el código: una
// clínica de Buenos Aires tiene que ver "+54".

const BY_TIMEZONE: [RegExp, string][] = [
  [/^(Europe\/Madrid|Atlantic\/Canary|Africa\/Ceuta)$/, '+34'],
  [/^America\/Argentina\//, '+54'],
  [/^America\/Buenos_Aires$/, '+54'],
  [/^America\/Montevideo$/, '+598'],
  [/^America\/(Mexico_City|Monterrey|Cancun|Merida|Tijuana|Chihuahua|Hermosillo|Mazatlan)$/, '+52'],
  [/^America\/Santiago$/, '+56'],
  [/^America\/Bogota$/, '+57'],
  [/^America\/Lima$/, '+51'],
  [/^Europe\/Lisbon$/, '+351'],
];

/** "+34" para Europe/Madrid; null si no se sabe (el campo va sin prefijo). */
export function dialPrefixForTimezone(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  for (const [re, prefix] of BY_TIMEZONE) if (re.test(timezone)) return prefix;
  return null;
}

/**
 * Lo que se guarda a partir de lo tecleado en un campo con prefijo: si la
 * persona escribe otro prefijo ("+33…", "0033…") se respeta; si escribe sólo
 * el número, se le antepone el de la clínica; vacío es vacío.
 */
export function withDialPrefix(typed: string, prefix: string | null): string {
  const v = typed.trim();
  if (!v) return '';
  if (!prefix || v.startsWith('+') || v.startsWith('00')) return v;
  return `${prefix}${v}`;
}

/** Lo que se enseña en el campo: el número sin el prefijo de la clínica. */
export function withoutDialPrefix(stored: string, prefix: string | null): string {
  if (!prefix) return stored;
  return stored.startsWith(prefix) ? stored.slice(prefix.length).trimStart() : stored;
}
