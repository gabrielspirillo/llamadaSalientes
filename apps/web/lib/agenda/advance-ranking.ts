/**
 * A quién se le ofrece un hueco que se libera, y en qué orden. Puro: trabaja
 * con instantes y con la zona horaria de la clínica; la base la consulta
 * `lib/agenda/advance-offers.ts`.
 *
 * El orden lo fijó la clínica y no se cambia a la ligera:
 *
 *  1. Quien tiene cita ESE MISMO DÍA, más tarde, y pidió adelantar (↑).
 *     Primero la cita más cercana al hueco.
 *  2. Si no hay nadie, los tres días siguientes, uno a uno: primero quien
 *     tiene cita a LA MISMA HORA que el hueco, luego la de justo antes
 *     (una duración por encima), luego la de justo después. Con ↑ o SIN
 *     marca: la clínica lo aclaró el 5/11 ("por norma general la gente
 *     siempre quiere adelantar"); sólo queda fuera "no mover". A igual
 *     hueco, primero quien marcó ↑. A esa familia le cambia el día, no la
 *     hora, y acepta más.
 *  3. Agotado eso, el resto de citas del mismo día que NO dijeron nada
 *     (sin ↑ ni "no mover"), empezando por la última hora del día.
 *
 * Quien dijo "no mover" no entra nunca. Quien ya recibió este hueco y lo
 * rechazó (o no contestó) tampoco: eso lo filtra quien llama.
 */
import { addDaysToKey, localDateKey, localParts } from '@/lib/tasks/tz';

export interface RankSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface RankCandidate {
  id: string;
  startsAt: Date;
  endsAt: Date;
  advancePreference: 'ACCEPTS' | 'NO_MOVE' | null;
  /** Marcada por la clínica como "ofrecerle el primer hueco". */
  advancePriority?: boolean;
}

export type OfferPhase = 'SAME_DAY_WANTS' | 'NEXT_DAYS_SAME_HOUR' | 'SAME_DAY_REST';

export interface RankedCandidate<T extends RankCandidate = RankCandidate> {
  candidate: T;
  phase: OfferPhase;
}

/** Días siguientes que se recorren en la fase 2. */
export const NEXT_DAYS = 3;
/** "La misma hora": a menos de esto, en minutos. */
const SAME_HOUR_TOLERANCE = 5;

function minuteOf(d: Date, tz: string): number {
  const p = localParts(d, tz);
  return p.hour * 60 + p.minute;
}

/**
 * Devuelve a TODOS los candidatos válidos, ya ordenados: el primero es a
 * quien se le ofrece ahora; si dice que no, el siguiente, etc.
 */
export function rankAdvanceCandidates<T extends RankCandidate>(
  slot: RankSlot,
  candidates: T[],
  tz: string,
): RankedCandidate<T>[] {
  const slotMs = slot.endsAt.getTime() - slot.startsAt.getTime();
  if (slotMs <= 0) return [];
  const slotDay = localDateKey(slot.startsAt, tz);
  const slotMinute = minuteOf(slot.startsAt, tz);
  const slotStep = Math.round(slotMs / 60_000);

  // Sólo citas posteriores al hueco, que quepan en él y que no sean "no mover".
  const valid = candidates.filter(
    (c) =>
      c.advancePreference !== 'NO_MOVE' &&
      c.startsAt.getTime() >= slot.endsAt.getTime() &&
      c.endsAt.getTime() - c.startsAt.getTime() <= slotMs,
  );
  // La prioridad que marca la clínica ("si se libera algo hoy, a X") manda
  // dentro de cada fase; a igualdad, la hora.
  const byTime = (a: T, b: T) =>
    Number(Boolean(b.advancePriority)) - Number(Boolean(a.advancePriority)) ||
    a.startsAt.getTime() - b.startsAt.getTime();
  const out: RankedCandidate<T>[] = [];
  const used = new Set<string>();
  const push = (c: T, phase: OfferPhase) => {
    if (used.has(c.id)) return;
    used.add(c.id);
    out.push({ candidate: c, phase });
  };

  // 1. Mismo día, quieren adelantar, la más cercana primero.
  for (const c of valid
    .filter((c) => c.advancePreference === 'ACCEPTS' && localDateKey(c.startsAt, tz) === slotDay)
    .sort(byTime)) {
    push(c, 'SAME_DAY_WANTS');
  }

  // 2. Días siguientes: misma hora, luego una por encima, luego una por debajo.
  for (let d = 1; d <= NEXT_DAYS; d++) {
    const dayKey = addDaysToKey(slotDay, d);
    const sameDay = valid.filter((c) => localDateKey(c.startsAt, tz) === dayKey);
    const score = (c: T): number | null => {
      const diff = minuteOf(c.startsAt, tz) - slotMinute;
      if (Math.abs(diff) <= SAME_HOUR_TOLERANCE) return 0;
      // Por encima (antes) gana a por debajo (después) a igual distancia.
      if (diff < 0 && -diff <= slotStep + SAME_HOUR_TOLERANCE) return 1;
      if (diff > 0 && diff <= slotStep + SAME_HOUR_TOLERANCE) return 2;
      return null;
    };
    const scored = sameDay
      .map((c) => ({ c, s: score(c) }))
      .filter((x): x is { c: T; s: number } => x.s !== null)
      .sort(
        (a, b) =>
          Number(Boolean(b.c.advancePriority)) - Number(Boolean(a.c.advancePriority)) ||
          a.s - b.s ||
          Number(b.c.advancePreference === 'ACCEPTS') -
            Number(a.c.advancePreference === 'ACCEPTS') ||
          byTime(a.c, b.c),
      );
    for (const { c } of scored) push(c, 'NEXT_DAYS_SAME_HOUR');
  }

  // 3. Resto del mismo día sin preferencia, desde la última hora hacia atrás.
  for (const c of valid
    .filter((c) => c.advancePreference === null && localDateKey(c.startsAt, tz) === slotDay)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())) {
    push(c, 'SAME_DAY_REST');
  }

  return out;
}
