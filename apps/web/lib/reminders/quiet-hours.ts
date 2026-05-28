// Aplica "quiet hours" al momento programado de un recordatorio.
//
// Si el `scheduledFor` calculado cae fuera del horario laboral de la clínica
// (en su zona horaria), lo mueve al próximo slot dentro de horario (modo
// SHIFT_INTO_HOURS) o lo descarta (modo SKIP).
//
// El horario laboral viene de `clinic_settings.workingHours` con keys
// 'monday' .. 'sunday' y valor `{ open: 'HH:MM', close: 'HH:MM' } | null`.
// null = día cerrado.
//
// Garantía: el resultado nunca queda después del `appointmentStart`. Si
// recortarlo lo llevaría más allá → SKIP `quiet_hours_full_day` (no sirve
// recordar después de la cita).

export type DayHours = { open: string; close: string } | null;
export type WorkingHours = Record<string, DayHours>;
export type QuietMode = 'SHIFT_INTO_HOURS' | 'SKIP';

export type QuietHoursOutcome =
  | { kind: 'ok'; scheduledFor: Date }
  | { kind: 'skip'; reason: 'quiet_hours_full_day' };

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
// Index 0 = Sunday (Intl weekday 'short' + getUTCDay convention).

function partsInTimeZone(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; weekdayIdx: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayShort = get('weekday'); // "Sun" | "Mon" | ... | "Sat"
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekdayIdx: weekdayMap[weekdayShort] ?? 0,
  };
}

// Construye un Date UTC que representa wall-clock { y, m, d, h, mm } en la TZ
// indicada. Usa el truco de ajuste por offset (compatible con DST excepto en
// el momento exacto de transición — aceptable).
function makeDateInTimeZone(
  y: number,
  m: number,
  d: number,
  h: number,
  mm: number,
  timeZone: string,
): Date {
  // Primer intento: interpretar (y, m, d, h, mm) como si fueran UTC.
  const guessUtc = Date.UTC(y, m - 1, d, h, mm, 0);
  const guessDate = new Date(guessUtc);
  // Ver qué wall clock representa esa fecha cuando se la mira en la TZ destino.
  const seen = partsInTimeZone(guessDate, timeZone);
  const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, 0);
  // La diferencia es exactamente el offset de la TZ en ese momento.
  const offset = guessUtc - seenUtc;
  return new Date(guessUtc + offset);
}

function parseHHMM(hhmm: string): { h: number; m: number } | null {
  const [hs, ms] = hhmm.split(':');
  const h = Number.parseInt(hs ?? '', 10);
  const m = Number.parseInt(ms ?? '', 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return { h, m };
}

export function applyQuietHours(args: {
  scheduledFor: Date;
  appointmentStart: Date;
  timeZone: string;
  workingHours: WorkingHours | null | undefined;
  mode: QuietMode;
}): QuietHoursOutcome {
  const { scheduledFor, appointmentStart, timeZone, workingHours, mode } = args;

  // Sin horario configurado → no hay restricción, devolver tal cual.
  if (!workingHours || Object.keys(workingHours).length === 0) {
    return { kind: 'ok', scheduledFor };
  }

  // Probar el día tal cual primero, hasta máximo 7 días forward.
  const seen = partsInTimeZone(scheduledFor, timeZone);
  let dayCursor = 0;

  while (dayCursor < 8) {
    // Calcular el wall-clock { y, m, d } para el cursor.
    const cursorDate = new Date(
      Date.UTC(seen.year, seen.month - 1, seen.day + dayCursor, 0, 0, 0),
    );
    const cursorParts = partsInTimeZone(cursorDate, timeZone);
    const dayKey = DAY_KEYS[cursorParts.weekdayIdx] ?? 'monday';
    const hours = workingHours[dayKey];

    if (!hours) {
      // Día cerrado, intentar siguiente.
      if (mode === 'SKIP' && dayCursor === 0) {
        return { kind: 'skip', reason: 'quiet_hours_full_day' };
      }
      dayCursor++;
      continue;
    }

    const open = parseHHMM(hours.open);
    const close = parseHHMM(hours.close);
    if (!open || !close) {
      dayCursor++;
      continue;
    }

    const openAt = makeDateInTimeZone(
      cursorParts.year,
      cursorParts.month,
      cursorParts.day,
      open.h,
      open.m,
      timeZone,
    );
    const closeAt = makeDateInTimeZone(
      cursorParts.year,
      cursorParts.month,
      cursorParts.day,
      close.h,
      close.m,
      timeZone,
    );

    if (dayCursor === 0) {
      // Mismo día del scheduledFor original.
      if (scheduledFor >= openAt && scheduledFor <= closeAt) {
        return { kind: 'ok', scheduledFor };
      }
      if (scheduledFor < openAt) {
        // Antes de abrir: mover al open del mismo día.
        if (mode === 'SKIP') {
          return { kind: 'skip', reason: 'quiet_hours_full_day' };
        }
        if (openAt > appointmentStart) {
          return { kind: 'skip', reason: 'quiet_hours_full_day' };
        }
        return { kind: 'ok', scheduledFor: openAt };
      }
      // scheduledFor > closeAt → buscar próximo día.
      if (mode === 'SKIP') {
        return { kind: 'skip', reason: 'quiet_hours_full_day' };
      }
      dayCursor++;
      continue;
    }

    // Días siguientes: usar el open de ese día.
    if (openAt > appointmentStart) {
      return { kind: 'skip', reason: 'quiet_hours_full_day' };
    }
    return { kind: 'ok', scheduledFor: openAt };
  }

  return { kind: 'skip', reason: 'quiet_hours_full_day' };
}
