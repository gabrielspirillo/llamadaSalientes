// Motor de disponibilidad de la agenda. TODO lo de este archivo es puro: no
// toca base ni red, y por eso se puede testear al detalle (ver
// `tests/unit/agenda-availability.test.ts`).
//
// El problema que resuelve: "el martes de 9 a 14" es una hora de PARED en la
// timezone de la clínica, mientras que las citas y los bloqueos son instantes.
// Mezclar las dos cosas es lo que hace que una agenda se corra una hora en
// marzo y en octubre. Aquí las franjas se convierten a instantes con la
// timezone concreta de cada día (`zonedToUtc` hace la doble pasada del DST) y a
// partir de ahí ya se trabaja sólo con instantes.

import {
  type Interval,
  type ShiftRule,
  type SlotCandidate,
  minutesToHHMM,
} from '@/lib/agenda/shared';
import { addDaysToKey, localDateKey, weekdayOfKey, zonedToUtc } from '@/lib/tasks/tz';

export interface SlotOptions {
  /** Timezone de la clínica (o del profesional si tiene una propia). */
  timezone: string;
  /** Duración de la cita, en minutos. */
  durationMinutes: number;
  /**
   * Cada cuánto empieza un hueco. 0 (o menos) = automático: las citas van una
   * detrás de otra, con el paso igual a la duración. Un valor explícito sirve
   * para encajar citas cortas en los ratos que dejan las largas.
   */
  granularityMinutes: number;
  /** Minutos muertos reservados DESPUÉS de cada cita. */
  bufferMinutes: number;
  /** No ofrecer huecos con menos de N horas de antelación. */
  minNoticeHours: number;
  /** Ni más allá de N días. */
  maxAdvanceDays: number;
  /** Instante actual. Se inyecta para poder testear. */
  now: Date;
}

export interface DayAvailabilityInput {
  /** 'YYYY-MM-DD' en la timezone de la clínica. */
  dateKey: string;
  shifts: ShiftRule[];
  /** Citas ya agendadas (sólo las que ocupan: ver BUSY_STATUSES). */
  appointments: Interval[];
  /** Bloqueos: vacaciones, festivos, formación. */
  blocks: Interval[];
  options: SlotOptions;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** ¿La franja está vigente ese día? `valid_from`/`valid_until` son inclusivos. */
export function shiftAppliesOn(shift: ShiftRule, dateKey: string): boolean {
  if (shift.active === false) return false;
  if (shift.weekday !== weekdayOfKey(dateKey)) return false;
  if (shift.validFrom && dateKey < shift.validFrom) return false;
  if (shift.validUntil && dateKey > shift.validUntil) return false;
  return true;
}

/**
 * Huecos libres de un profesional en un día concreto.
 *
 * Un hueco entra si (a) cabe entero dentro de una franja de trabajo, (b) no se
 * pisa con ninguna cita ni bloqueo — contando el buffer a ambos lados — y (c)
 * respeta la antelación mínima y máxima.
 */
export function computeDaySlots(input: DayAvailabilityInput): SlotCandidate[] {
  const { dateKey, shifts, appointments, blocks, options } = input;
  const {
    timezone,
    durationMinutes,
    granularityMinutes,
    bufferMinutes,
    minNoticeHours,
    maxAdvanceDays,
    now,
  } = options;

  if (durationMinutes <= 0) return [];
  const step = granularityMinutes > 0 ? granularityMinutes : durationMinutes;

  const earliest = new Date(now.getTime() + minNoticeHours * 3_600_000);
  const latest = new Date(now.getTime() + maxAdvanceDays * 86_400_000);

  const parts = dateKey.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return [];

  const out: SlotCandidate[] = [];
  const seen = new Set<number>();

  for (const shift of shifts) {
    if (!shiftAppliesOn(shift, dateKey)) continue;

    for (
      let startMinute = shift.startMinute;
      startMinute + durationMinutes <= shift.endMinute;
      startMinute += step
    ) {
      const start = zonedToUtc(
        year,
        month,
        day,
        Math.floor(startMinute / 60),
        startMinute % 60,
        timezone,
      );
      const end = new Date(start.getTime() + durationMinutes * 60_000);

      if (start.getTime() < earliest.getTime()) continue;
      if (start.getTime() > latest.getTime()) continue;
      // Dos franjas del mismo día pueden solaparse por error de carga; no
      // ofrecemos el mismo hueco dos veces.
      if (seen.has(start.getTime())) continue;

      const busy = appointments.some((a) =>
        overlaps(
          start,
          new Date(end.getTime() + bufferMinutes * 60_000),
          a.start,
          new Date(a.end.getTime() + bufferMinutes * 60_000),
        ),
      );
      if (busy) continue;

      // Los bloqueos no llevan buffer: son ausencia, no gabinete ocupado.
      const blocked = blocks.some((b) => overlaps(start, end, b.start, b.end));
      if (blocked) continue;

      seen.add(start.getTime());
      out.push({ start, end });
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface RangeAvailabilityInput {
  /** 'YYYY-MM-DD' inclusive. */
  fromDateKey: string;
  /** 'YYYY-MM-DD' inclusive. */
  toDateKey: string;
  shifts: ShiftRule[];
  appointments: Interval[];
  blocks: Interval[];
  options: SlotOptions;
  /** Corta la búsqueda al llegar a N huecos (los agentes sólo leen los primeros). */
  limit?: number;
}

/** Huecos libres en un rango de días. Recorre día a día en hora local. */
export function computeRangeSlots(input: RangeAvailabilityInput): SlotCandidate[] {
  const { fromDateKey, toDateKey, shifts, appointments, blocks, options, limit } = input;
  const out: SlotCandidate[] = [];
  let cursor = fromDateKey;
  // Tope duro: una agenda no se explora más de un año hacia delante ni aunque
  // el caller pase un rango absurdo.
  for (let guard = 0; guard < 400 && cursor <= toDateKey; guard++) {
    const daySlots = computeDaySlots({
      dateKey: cursor,
      shifts,
      appointments,
      blocks,
      options,
    });
    for (const slot of daySlots) {
      out.push(slot);
      if (limit && out.length >= limit) return out;
    }
    cursor = addDaysToKey(cursor, 1);
  }
  return out;
}

/**
 * ¿Este intervalo cae dentro del horario de trabajo del profesional?
 *
 * Se usa para las reservas que NO vienen de la rejilla de huecos: los agentes
 * virtuales tienen que respetar el horario, mientras que recepción puede
 * encajar una urgencia fuera de él a sabiendas.
 */
export function isInsideWorkingHours(
  start: Date,
  end: Date,
  shifts: ShiftRule[],
  timezone: string,
): boolean {
  const dateKey = localDateKey(start, timezone);
  const parts = dateKey.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  return shifts.some((shift) => {
    if (!shiftAppliesOn(shift, dateKey)) return false;
    const shiftStart = zonedToUtc(
      year,
      month,
      day,
      Math.floor(shift.startMinute / 60),
      shift.startMinute % 60,
      timezone,
    );
    const shiftEnd = zonedToUtc(
      year,
      month,
      day,
      Math.floor(shift.endMinute / 60),
      shift.endMinute % 60,
      timezone,
    );
    return start.getTime() >= shiftStart.getTime() && end.getTime() <= shiftEnd.getTime();
  });
}

/**
 * Motivo por el que un intervalo NO se puede agendar, o null si se puede.
 * Devuelve texto en español porque lo consumen tanto la UI como los agentes.
 */
export function describeConflict(
  start: Date,
  end: Date,
  appointments: Interval[],
  blocks: Interval[],
  bufferMinutes = 0,
): string | null {
  const clash = appointments.find((a) =>
    overlaps(
      start,
      new Date(end.getTime() + bufferMinutes * 60_000),
      a.start,
      new Date(a.end.getTime() + bufferMinutes * 60_000),
    ),
  );
  if (clash) return 'Ese horario se pisa con otra cita del profesional.';

  const block = blocks.find((b) => overlaps(start, end, b.start, b.end));
  if (block) return 'El profesional tiene ese horario bloqueado.';

  return null;
}

/** Agrupa huecos por día local para la UI y para el discurso de los agentes. */
export function groupSlotsByDay(
  slots: SlotCandidate[],
  timezone: string,
): { dateKey: string; slots: SlotCandidate[] }[] {
  const map = new Map<string, SlotCandidate[]>();
  for (const slot of slots) {
    const key = localDateKey(slot.start, timezone);
    const list = map.get(key);
    if (list) list.push(slot);
    else map.set(key, [slot]);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, list]) => ({ dateKey, slots: list }));
}

/** 'HH:MM' local de un instante. Útil para pintar y para hablar. */
export function localHHMM(date: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return fmt.format(date);
}

export { minutesToHHMM };
