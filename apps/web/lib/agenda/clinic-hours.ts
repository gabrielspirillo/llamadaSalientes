import { localParts } from '@/lib/tasks/tz';

/** Horario de atención de la clínica (Datos de la clínica): por día, o null = cerrado. */
export type ClinicWorkingHours = Record<string, { open: string; close: string } | null>;

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * ¿La cita cae entera dentro del horario de atención de la clínica? Es el
 * límite que manda sobre la jornada de cada profesional: lo que la clínica
 * dice que abre es lo único que el asistente puede ofrecer.
 *
 * Sin horario cargado (null o vacío) no restringe: muchas clínicas sólo
 * configuran la jornada de los profesionales. Un día que no aparece o va a
 * null está cerrado. Puro, para testearlo sin base.
 */
export function withinClinicHours(
  start: Date,
  end: Date,
  timezone: string,
  hours: ClinicWorkingHours | null | undefined,
): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;
  const s = localParts(start, timezone);
  const day = hours[DAY_KEYS[s.weekday - 1] ?? ''];
  if (!day) return false;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (open === null || close === null) return true;
  const startMin = s.hour * 60 + s.minute;
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);
  return startMin >= open && startMin + durationMin <= close;
}

const DAY_LABEL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Días ISO (1 = lunes … 7 = domingo) en que la clínica NO abre. Vacío sin horario cargado. */
export function closedWeekdays(hours: ClinicWorkingHours | null | undefined): number[] {
  if (!hours || Object.keys(hours).length === 0) return [];
  return DAY_KEYS.map((k, i) => (hours[k] ? 0 : i + 1)).filter((d) => d > 0);
}

/** "sábado y domingo", para decírselo al asistente. '' si abre todos los días o no hay horario. */
export function closedDaysLabel(hours: ClinicWorkingHours | null | undefined): string {
  const names = closedWeekdays(hours).map((d) => DAY_LABEL[d - 1] ?? '');
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** El nombre del día ("sábado") de una fecha YYYY-MM-DD. */
export function weekdayLabelOfKey(key: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const iso = ((d.getUTCDay() + 6) % 7) + 1;
  return DAY_LABEL[iso - 1] ?? null;
}

export function isoWeekdayOfKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return ((d.getUTCDay() + 6) % 7) + 1;
}
