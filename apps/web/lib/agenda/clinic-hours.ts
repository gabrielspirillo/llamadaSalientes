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
