// Motor de recurrencia de las rutinas (apertura, cierre, controles legales…).
//
// Deliberadamente NO es un RRULE completo: una clínica necesita "todos los días
// laborables", "cada lunes", "el 1 de cada mes" y "una vez al año". Un iCal
// entero sería más superficie de error para cero valor extra.
//
// Puro y sin I/O: el worker lo llama por tenant, los tests lo llaman directo.

import type { TaskRecurrenceFreq } from '@/lib/tasks/constants';
import { addDaysToKey, daysBetweenKeys, parseDateKey, weekdayOfKey } from '@/lib/tasks/tz';

export interface RecurrenceSpec {
  freq: TaskRecurrenceFreq;
  interval: number;
  /** ISO 1=lunes … 7=domingo. Solo WEEKLY. */
  weekdays: number[];
  /** Día del mes 1-28. MONTHLY / QUARTERLY / YEARLY. */
  monthDay: number | null;
  /** Mes 1-12. Solo YEARLY. */
  month: number | null;
  /** Clave 'YYYY-MM-DD' desde la que se cuentan los intervalos. */
  anchorDateKey: string;
}

/** ¿Toca la rutina el día `dateKey` ('YYYY-MM-DD')? */
export function occursOn(spec: RecurrenceSpec, dateKey: string): boolean {
  const parts = parseDateKey(dateKey);
  const anchor = parseDateKey(spec.anchorDateKey);
  if (!parts || !anchor) return false;
  // Nada anterior al alta de la plantilla.
  if (daysBetweenKeys(spec.anchorDateKey, dateKey) < 0) return false;

  const interval = Math.max(1, spec.interval || 1);
  const weekday = weekdayOfKey(dateKey);

  switch (spec.freq) {
    case 'DAILY':
      return daysBetweenKeys(spec.anchorDateKey, dateKey) % interval === 0;

    case 'WEEKDAYS':
      return weekday >= 1 && weekday <= 5;

    case 'WEEKLY': {
      const days = spec.weekdays.length > 0 ? spec.weekdays : [weekdayOfKey(spec.anchorDateKey)];
      if (!days.includes(weekday)) return false;
      if (interval === 1) return true;
      // Semanas completas transcurridas desde el lunes de la semana ancla.
      const anchorMonday = addDaysToKey(spec.anchorDateKey, 1 - weekdayOfKey(spec.anchorDateKey));
      const thisMonday = addDaysToKey(dateKey, 1 - weekday);
      const weeks = Math.round(daysBetweenKeys(anchorMonday, thisMonday) / 7);
      return weeks % interval === 0;
    }

    case 'MONTHLY': {
      const day = spec.monthDay ?? anchor.day;
      if (parts.day !== clampMonthDay(day)) return false;
      const months = monthsBetween(anchor, parts);
      return months >= 0 && months % interval === 0;
    }

    case 'QUARTERLY': {
      const day = spec.monthDay ?? anchor.day;
      if (parts.day !== clampMonthDay(day)) return false;
      const months = monthsBetween(anchor, parts);
      return months >= 0 && months % (3 * interval) === 0;
    }

    case 'YEARLY': {
      const day = spec.monthDay ?? anchor.day;
      const month = spec.month ?? anchor.month;
      if (parts.day !== clampMonthDay(day) || parts.month !== month) return false;
      const years = parts.year - anchor.year;
      return years >= 0 && years % interval === 0;
    }

    default:
      return false;
  }
}

/**
 * Días que hay que materializar para una rutina.
 *
 * Ventana: desde el día siguiente al último materializado (o hoy si nunca corrió)
 * hasta hoy + leadDays. Se acota a `maxLookbackDays` para que una plantilla
 * dormida tres meses no vomite 90 tareas al reactivarse.
 */
export function pendingOccurrences(args: {
  spec: RecurrenceSpec;
  todayKey: string;
  leadDays: number;
  lastMaterializedOn: string | null;
  maxLookbackDays?: number;
}): string[] {
  const { spec, todayKey, lastMaterializedOn } = args;
  const leadDays = Math.max(0, Math.min(60, args.leadDays));
  const maxLookback = args.maxLookbackDays ?? 7;

  const earliestAllowed = addDaysToKey(todayKey, -maxLookback);
  let cursor =
    lastMaterializedOn && daysBetweenKeys(lastMaterializedOn, todayKey) >= 0
      ? addDaysToKey(lastMaterializedOn, 1)
      : earliestAllowed;
  if (daysBetweenKeys(earliestAllowed, cursor) < 0) cursor = earliestAllowed;

  const end = addDaysToKey(todayKey, leadDays);
  const out: string[] = [];
  // Guardia dura: la ventana nunca puede pasar de ~70 iteraciones.
  for (let i = 0; i < 90 && daysBetweenKeys(cursor, end) >= 0; i += 1) {
    if (occursOn(spec, cursor)) out.push(cursor);
    cursor = addDaysToKey(cursor, 1);
  }
  return out;
}

/** Los meses cortos no tienen 29-31: el catálogo se queda en 1-28. */
function clampMonthDay(day: number): number {
  return Math.min(28, Math.max(1, day));
}

function monthsBetween(
  a: { year: number; month: number },
  b: { year: number; month: number },
): number {
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Texto humano de la recurrencia, para la tarjeta de rutina. */
export function describeRecurrence(spec: RecurrenceSpec, dueTime: string): string {
  const at = ` a las ${dueTime}`;
  const every = spec.interval > 1 ? `cada ${spec.interval} ` : '';
  switch (spec.freq) {
    case 'DAILY':
      return spec.interval > 1 ? `Cada ${spec.interval} días${at}` : `Todos los días${at}`;
    case 'WEEKDAYS':
      return `De lunes a viernes${at}`;
    case 'WEEKLY': {
      const names = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
      const days = (spec.weekdays.length > 0 ? spec.weekdays : [weekdayOfKey(spec.anchorDateKey)])
        .slice()
        .sort((x, y) => x - y)
        .map((d) => names[d])
        .join(', ');
      return `${every ? `Cada ${spec.interval} semanas` : 'Cada semana'}: ${days}${at}`;
    }
    case 'MONTHLY':
      return `${every ? `Cada ${spec.interval} meses` : 'Cada mes'}, día ${spec.monthDay ?? 1}${at}`;
    case 'QUARTERLY':
      return `Cada trimestre, día ${spec.monthDay ?? 1}${at}`;
    case 'YEARLY': {
      const months = [
        '',
        'enero',
        'febrero',
        'marzo',
        'abril',
        'mayo',
        'junio',
        'julio',
        'agosto',
        'septiembre',
        'octubre',
        'noviembre',
        'diciembre',
      ];
      return `Cada año, ${spec.monthDay ?? 1} de ${months[spec.month ?? 1]}${at}`;
    }
    default:
      return 'Sin recurrencia';
  }
}
