import { localDateKey, zonedToUtc } from '@/lib/tasks/tz';

/**
 * Qué hueco quiso decir el agente con su `start_time`.
 *
 * El modelo no copia bien un ISO en UTC: escribe la hora que dijo el paciente
 * ("16:00") con la Z detrás, y "16:00Z" en Madrid son las 17:00. Eso dejaba
 * citas una hora corridas o decía "ocupado" de un hueco libre. Aquí se
 * prueban las dos lecturas —el instante tal cual y la hora de pared de la
 * clínica— y gana la que coincide con un hueco libre de verdad.
 *
 * check_availability ofrece la hora de la clínica sin zona ("2026-11-03
 * 16:00"), así que la hora de pared va primero: el error típico del modelo es
 * añadirle una Z. Si esa lectura no es un hueco libre y trae zona, se prueba
 * el instante tal cual (un ISO de los de antes, que quedan en el historial).
 *
 * Devuelve el instante elegido (o null si ninguno está libre) y el día local
 * que el agente tenía en mente, para listar lo que sí hay. Puro.
 */
export function matchRequestedSlot(
  raw: string,
  timezone: string,
  freeStarts: Date[],
): { start: Date | null; dayKey: string | null } {
  const text = raw.trim();
  const wallMatch = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/.exec(text);
  const wall = wallMatch
    ? zonedToUtc(
        Number(wallMatch[1]),
        Number(wallMatch[2]),
        Number(wallMatch[3]),
        Number(wallMatch[4]),
        Number(wallMatch[5]),
        timezone,
      )
    : null;
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(text);
  const instant = hasZone ? new Date(text) : null;

  const candidates = [
    ...(wall ? [wall] : []),
    ...(instant && !Number.isNaN(instant.getTime()) ? [instant] : []),
  ];
  const sameMinute = (a: Date, b: Date) =>
    Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
  const start = candidates.find((c) => freeStarts.some((f) => sameMinute(f, c))) ?? null;

  // El día que el paciente tenía en mente es el de la hora de pared.
  const ref = wall ?? candidates[0] ?? null;
  return { start, dayKey: ref ? localDateKey(ref, timezone) : null };
}
