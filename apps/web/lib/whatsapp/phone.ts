/**
 * Números de WhatsApp, en el único formato que entienden los proveedores: E.164.
 *
 * Es aparte de `normalizePatientPhone` (lib/agenda/patients.ts) a propósito.
 * Aquel normaliza lo que llega del canal —un número que YA existe, porque el
 * paciente escribió desde él— y para eso puede ser permisivo. Este valida lo
 * que una persona teclea en un formulario, y ahí ser permisivo hace daño: un
 * móvil español escrito "600 11 22 33" se convertiría en `+600112233`, un
 * número de Burkina Faso que el proveedor acepta y al que el mensaje sale
 * —cobrado— sin que nadie se entere de que el profesional nunca lo recibió.
 *
 * Puro: sin base, sin red. Se testea solo.
 */

export type WhatsappPhoneParse = { ok: true; e164: string } | { ok: false; error: string };

const SOLO_DIGITOS_Y_MAS = /[^\d+]/g;

/**
 * Valida y normaliza un número tecleado a mano.
 *
 * Acepta las tres formas en que la gente escribe un número internacional:
 * `+34600111222`, `0034600111222` y `34600111222`. Rechaza el número local sin
 * prefijo, que es justo el error que deja un destinatario inventado.
 */
export function parseWhatsappPhone(raw: string | null | undefined): WhatsappPhoneParse {
  const limpio = (raw ?? '').replace(SOLO_DIGITOS_Y_MAS, '');
  if (!limpio) return { ok: false, error: 'Escribe el número de WhatsApp.' };

  // El `+` sólo vale al principio y una vez.
  if (limpio.indexOf('+') > 0 || (limpio.match(/\+/g)?.length ?? 0) > 1) {
    return { ok: false, error: 'El signo + va sólo al principio, delante del prefijo del país.' };
  }

  let digitos = limpio.startsWith('+') ? limpio.slice(1) : limpio;
  const teniaMas = limpio.startsWith('+');

  // 00 es cómo se marca el internacional desde un teléfono: equivale al +.
  let tenia00 = false;
  if (!teniaMas && digitos.startsWith('00')) {
    digitos = digitos.slice(2);
    tenia00 = true;
  }

  if (!/^\d+$/.test(digitos)) {
    return { ok: false, error: 'El número sólo puede llevar dígitos, y el + del prefijo.' };
  }
  if (digitos.startsWith('0')) {
    return {
      ok: false,
      error: 'Quita el 0 inicial: después del prefijo del país va el número sin el 0 nacional.',
    };
  }
  if (digitos.length < 8) {
    return { ok: false, error: 'Faltan dígitos. Escribe el número completo con su prefijo.' };
  }
  if (digitos.length > 15) {
    return { ok: false, error: 'Sobran dígitos: un número internacional tiene 15 como mucho.' };
  }
  // Sin `+` ni `00` sólo se acepta si es largo como para llevar prefijo dentro.
  // Nueve dígitos son un móvil nacional y no sabemos de qué país.
  if (!teniaMas && !tenia00 && digitos.length < 10) {
    return {
      ok: false,
      error: 'Falta el prefijo del país. Escríbelo con + delante, por ejemplo +34 600 11 22 33.',
    };
  }

  return { ok: true, e164: `+${digitos}` };
}

/** La variante corta: el E.164 o null. Para cuando el motivo del fallo da igual. */
export function normalizeWhatsappE164(raw: string | null | undefined): string | null {
  const parsed = parseWhatsappPhone(raw);
  return parsed.ok ? parsed.e164 : null;
}
