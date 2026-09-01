/**
 * Franja de silencio. Módulo aparte y SIN `server-only` ni acceso a la base a
 * propósito: es lógica pura y tiene que poder probarse sin levantar el entorno
 * entero. (Mismo criterio que `lib/tasks/tz.ts`.)
 */

/**
 * ¿Está la persona en su franja de silencio ahora mismo?
 *
 * `nowHHMM` va en la zona de la clínica, no en la del servidor.
 *
 * El caso que importa es el que la gente configura de verdad —21:00 a 08:00—,
 * que cruza la medianoche: con una comparación ingenua nunca silenciaría nada.
 */
export function isWithinDnd(
  from: string | null | undefined,
  to: string | null | undefined,
  nowHHMM: string,
): boolean {
  if (!from || !to) return false;
  // Ancho cero: lo seguro es NO silenciar. Silenciar 24 h por un descuido al
  // configurar dejaría a alguien incomunicado sin que se entere.
  if (from === to) return false;
  if (from < to) return nowHHMM >= from && nowHHMM < to;
  return nowHHMM >= from || nowHHMM < to;
}
