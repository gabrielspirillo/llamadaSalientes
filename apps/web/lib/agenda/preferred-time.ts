import { localParts } from '@/lib/tasks/tz';

/**
 * "Sobre las 16:30": la hora que pide la familia, en minutos del día. Acepta
 * "16:30", "16.30", "16h30", "16", "4 y media de la tarde" no (eso lo traduce
 * el modelo). Null si no se entiende.
 */
export function parsePreferredTime(raw: string | null | undefined): number | null {
  const m = raw?.trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Ordena los huecos por cercanía a la hora pedida (primero los de esa hora
 * exacta) y, a igual distancia, por fecha. Sin esto el asistente sólo veía los
 * 4 huecos que elige la agenda compacta y, a "¿algún día sobre las 16:30?",
 * contestaba que no había nada con el viernes a las 16:30 libre (13/11).
 */
export function rankByPreferredTime<T extends { start: Date }>(
  options: T[],
  timezone: string,
  preferredMinute: number,
): T[] {
  const minuteOf = (d: Date) => {
    const p = localParts(d, timezone);
    return p.hour * 60 + p.minute;
  };
  return [...options].sort(
    (a, b) =>
      Math.abs(minuteOf(a.start) - preferredMinute) -
        Math.abs(minuteOf(b.start) - preferredMinute) || a.start.getTime() - b.start.getTime(),
  );
}

/** ¿El hueco empieza exactamente a la hora pedida? */
export function startsAtMinute(start: Date, timezone: string, minute: number): boolean {
  const p = localParts(start, timezone);
  return p.hour * 60 + p.minute === minute;
}
