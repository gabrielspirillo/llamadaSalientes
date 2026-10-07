// Normalización para buscar pacientes por nombre. Puro, sin base: lo comparten
// la query (en SQL, con `translate`) y los tests.
//
// "santalla", "Santallá" y "SANTALLA" tienen que dar lo mismo. No se usa la
// extensión `unaccent` porque instalarla pide superusuario y no queremos que
// la búsqueda dependa de cómo se creó la base: `translate` es estándar.

/** Letras con tilde (ya en minúscula) y su versión sin tilde, posición a posición. */
export const FOLD_FROM = 'áàäâãåéèëêíìïîóòöôõúùüûñçý';
export const FOLD_TO = 'aaaaaaeeeeiiiiooooouuuuncy';

/** Minúsculas y sin tildes: lo mismo que hace `foldSql` del lado de Postgres. */
export function foldSearchText(value: string): string {
  let out = '';
  for (const ch of value.trim().toLocaleLowerCase('es')) {
    const i = FOLD_FROM.indexOf(ch);
    out += i >= 0 ? FOLD_TO[i] : ch;
  }
  return out;
}

/** `%` y `_` son comodines de LIKE: quien teclea "50%" busca un 50%, no "50 y lo que sea". */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Si lo tecleado es un teléfono, sus dígitos; si no, null. "600 29 68 83",
 * "+34600296883" y "600-29" valen; "Julieta 2" no. Con menos de tres dígitos
 * no se busca por teléfono: casaría con medio listado.
 */
export function phoneDigitsQuery(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 3 ? digits : null;
}
