import 'server-only';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** Inicio de hoy en hora local del servidor (00:00). */
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Inicio de mañana — útil para queries de "hoy" como [startOfToday, startOfTomorrow). */
export function startOfTomorrow(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

/** Inicio del mes actual (día 1, 00:00). */
export function startOfCurrentMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

/** Punto temporal `days` atrás desde el inicio de hoy. */
export function daysAgo(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - days);
  return d;
}

/** Conversión cents -> número en unidades enteras (no formatea moneda). */
export function centsToUnits(cents: number): number {
  return Math.round(cents) / 100;
}
