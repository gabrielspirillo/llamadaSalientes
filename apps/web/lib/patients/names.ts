// Nombres y teléfonos tal como se enseñan. Puro, sin base: lo usan el
// servidor al guardar, el panel al pintar y los tests.

/** Partículas que van en minúscula dentro de un nombre: "Ortiz de la Cruz". */
const PARTICLES = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'e',
  'da',
  'do',
  'dos',
  'das',
  'van',
  'von',
  'di',
  'du',
  'der',
  'den',
  'le',
  'el',
  'al',
]);

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toLocaleUpperCase('es') + word.slice(1);
}

/**
 * "ADrian ortiz DE LA cruz" → "Adrian Ortiz de la Cruz". Se aplica al guardar:
 * un nombre tecleado con la mayúscula pegada o en versales acaba en la
 * cabecera de la ficha, en el WhatsApp del tutor y en el PDF del
 * consentimiento, y no hay que corregirlo tres veces.
 *
 * Respeta guiones y apóstrofos ("Jean-Luc", "O'Neil") y deja en minúscula las
 * partículas salvo si van primero.
 */
export function titleCaseName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  return s
    .split(' ')
    .map((word, index) => {
      const lower = word.toLocaleLowerCase('es');
      if (index > 0 && PARTICLES.has(lower)) return lower;
      return lower
        .split(/([-'’])/)
        .map((part) => (/^[-'’]$/.test(part) ? part : capitalize(part)))
        .join('');
    })
    .join(' ');
}

/** "Martina López" → "ML". Para el avatar de la ficha. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toLocaleUpperCase('es'))
    .join('');
}

/**
 * Prefijos de país de dos cifras (asignación de la UIT). Todo lo que empiece
 * por 1 o 7 es de una cifra; lo que no esté aquí, de tres.
 */
const TWO_DIGIT_CC = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);

function splitCountryCode(digits: string): { cc: string; national: string } {
  if (digits.startsWith('1') || digits.startsWith('7')) {
    return { cc: digits.slice(0, 1), national: digits.slice(1) };
  }
  if (TWO_DIGIT_CC.has(digits.slice(0, 2))) {
    return { cc: digits.slice(0, 2), national: digits.slice(2) };
  }
  return { cc: digits.slice(0, 3), national: digits.slice(3) };
}

function groupDigits(national: string, sizes: number[]): string {
  const out: string[] = [];
  let i = 0;
  for (const size of sizes) {
    if (i >= national.length) break;
    out.push(national.slice(i, i + size));
    i += size;
  }
  if (i < national.length) out.push(national.slice(i));
  return out.join(' ');
}

/**
 * "+59892206700" → "+598 92 206 700"; "+34600112233" → "+34 600 11 22 33".
 * Sin libreta de países: separa el prefijo por su longitud y agrupa el resto
 * como se lee en voz alta. Lo que no parezca un número en formato
 * internacional se devuelve tal cual.
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const digits = s.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+') || digits.length < 8) return s;
  const { cc, national } = splitCountryCode(digits.slice(1));
  let grouped: string;
  if (cc === '34' && national.length === 9) grouped = groupDigits(national, [3, 2, 2, 2]);
  else if (national.length <= 4) grouped = national;
  else if (national.length === 7) grouped = groupDigits(national, [3, 4]);
  else if (national.length === 8) grouped = groupDigits(national, [2, 3, 3]);
  else if (national.length === 9) grouped = groupDigits(national, [3, 3, 3]);
  else if (national.length === 10) grouped = groupDigits(national, [3, 3, 4]);
  else if (national.length === 11) grouped = groupDigits(national, [3, 4, 4]);
  else grouped = groupDigits(national, Array(Math.ceil(national.length / 3)).fill(3));
  return `+${cc} ${grouped}`.trim();
}

/** Sólo dígitos, para `tel:` y `wa.me`. */
export function phoneDigits(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}
