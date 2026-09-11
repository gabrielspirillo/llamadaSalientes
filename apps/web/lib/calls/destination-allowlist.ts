/**
 * Lista blanca de países a los que puede marcar la demo pública.
 *
 * `/api/public/demo-call` no tiene auth: cualquiera con la URL puede pedir una
 * llamada a cualquier número del mundo, con nuestro caller ID y a nuestro
 * cargo. El 5 y el 7 de septiembre de 2026 alguien lo usó para marcar a unos
 * 25 números de Serbia, Kenia, Sri Lanka, Israel, Zambia… (fraude IRSF: números
 * de tarificación especial que reparten lo recaudado con quien los llama) y
 * vació el saldo de Zadarma. Desde entonces la demo "conectaba" con la locución
 * de "no hay fondos suficientes" y el visitante nunca recibía la llamada.
 *
 * El rate-limit por IP no frena eso: rotan IPs y números. Lo que sí lo frena es
 * negarse a marcar fuera de los mercados donde la demo tiene sentido.
 *
 * Decisiones:
 * - Sin puerta trasera: no existe un valor que signifique "todos los países".
 *   Una variable vacía o mal escrita cae al defecto, nunca a permitir todo.
 * - Los prefijos son los indicativos E.164 sin el "+". Se compara por prefijo,
 *   así que "1" abriría también todo el Caribe (+1809 Rep. Dominicana, +1876
 *   Jamaica…), destinos clásicos de IRSF. Por eso no está en el defecto.
 */

/** Indicativos permitidos si `FUTURA_DEMO_ALLOWED_COUNTRY_CODES` no está. */
export const DEFAULT_DEMO_ALLOWED_COUNTRY_CODES: readonly string[] = [
  '34', // España
  '54', // Argentina
  '598', // Uruguay
  '52', // México
  '56', // Chile
  '57', // Colombia
  '51', // Perú
];

/** Nombres para el mensaje al visitante. Un código sin nombre se muestra como "+NN". */
const COUNTRY_NAMES: Record<string, string> = {
  '34': 'España',
  '54': 'Argentina',
  '598': 'Uruguay',
  '52': 'México',
  '56': 'Chile',
  '57': 'Colombia',
  '51': 'Perú',
  '55': 'Brasil',
  '58': 'Venezuela',
  '591': 'Bolivia',
  '593': 'Ecuador',
  '595': 'Paraguay',
  '502': 'Guatemala',
  '503': 'El Salvador',
  '504': 'Honduras',
  '505': 'Nicaragua',
  '506': 'Costa Rica',
  '507': 'Panamá',
  '351': 'Portugal',
  '39': 'Italia',
  '33': 'Francia',
  '44': 'Reino Unido',
  '49': 'Alemania',
  '1': 'EE. UU. y Canadá',
};

/**
 * Lee la lista de la variable de entorno: indicativos separados por comas,
 * con o sin "+", con o sin espacios. Lo que no sea de 1 a 4 dígitos se ignora.
 * Si no queda ninguno válido, se usa el defecto (nunca "todo permitido").
 */
export function parseAllowedCountryCodes(raw: string | null | undefined): string[] {
  if (raw == null) return [...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES];
  const codes = raw
    .split(',')
    .map((s) => s.trim().replace(/^\+/, ''))
    .filter((s) => /^\d{1,4}$/.test(s));
  const unique = [...new Set(codes)];
  return unique.length > 0 ? unique : [...DEFAULT_DEMO_ALLOWED_COUNTRY_CODES];
}

/**
 * Indicativo de la lista con el que empieza el número, o `null` si no está
 * permitido. Si varios encajan gana el más largo, para que el mensaje diga el
 * país correcto (con "5" y "598" en la lista, +598… es Uruguay, no "+5").
 */
export function matchAllowedCountryCode(
  e164: string,
  codes: readonly string[] = DEFAULT_DEMO_ALLOWED_COUNTRY_CODES,
): string | null {
  const digits = e164.replace(/^\+/, '');
  let best: string | null = null;
  for (const code of codes) {
    if (digits.startsWith(code) && (best === null || code.length > best.length)) {
      best = code;
    }
  }
  return best;
}

export function isDestinationAllowed(
  e164: string,
  codes: readonly string[] = DEFAULT_DEMO_ALLOWED_COUNTRY_CODES,
): boolean {
  return matchAllowedCountryCode(e164, codes) !== null;
}

/** "España, Argentina, Uruguay y Perú" — para el mensaje de rechazo. */
export function describeAllowedCountries(
  codes: readonly string[] = DEFAULT_DEMO_ALLOWED_COUNTRY_CODES,
): string {
  const names = codes.map((c) => COUNTRY_NAMES[c] ?? `+${c}`);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}
