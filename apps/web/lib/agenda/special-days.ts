// Días con horario especial: reglas puras (sin base de datos), con tests.
//
// Respinens atiende de tarde y algunos días sueltos abre también por la mañana
// (o sólo por la mañana). Un día especial sustituye, en esa fecha, el horario
// semanal del profesional por las franjas que se indiquen.

export type MinuteRange = { start: number; end: number };

export const MAX_SPECIAL_RANGES = 3;
/** Hasta cuándo se puede programar un día especial. */
export const MAX_SPECIAL_DAYS_AHEAD = 366;
/** Franja más corta con sentido (una cita corta). */
export const MIN_RANGE_MINUTES = 15;

/** "09:30" → 570. Null si no es una hora válida. */
export function parseClock(raw: string | null | undefined): number | null {
  const m = raw?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 570 → "9:30" (como se dice), 900 → "15:00". */
export function formatClock(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** 570 → "09:30" (para un input type=time). */
export function formatClockInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Valida y ordena las franjas de un día especial. Devuelve el error en
 * palabras de la clínica, o las franjas ordenadas. Dos franjas que se tocan
 * ("9-13" y "13-15") se juntan en una.
 */
export function normalizeRanges(
  raw: Array<{ start: number; end: number }>,
): { ok: true; ranges: MinuteRange[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'Indica al menos una franja (desde y hasta).' };
  }
  if (raw.length > MAX_SPECIAL_RANGES) {
    return { ok: false, error: `Como mucho ${MAX_SPECIAL_RANGES} franjas en un día.` };
  }
  for (const r of raw) {
    if (
      !Number.isInteger(r.start) ||
      !Number.isInteger(r.end) ||
      r.start < 0 ||
      r.end > 24 * 60 ||
      r.start >= r.end
    ) {
      return { ok: false, error: 'Cada franja tiene que empezar antes de acabar.' };
    }
    if (r.end - r.start < MIN_RANGE_MINUTES) {
      return {
        ok: false,
        error: `Una franja tiene que durar al menos ${MIN_RANGE_MINUTES} minutos.`,
      };
    }
  }
  const sorted = [...raw].sort((a, b) => a.start - b.start);
  const merged: MinuteRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) {
      return {
        ok: false,
        error: `Las franjas se solapan (${formatClock(last.start)}-${formatClock(last.end)} y ${formatClock(r.start)}-${formatClock(r.end)}).`,
      };
    }
    if (last && r.start === last.end) last.end = r.end;
    else merged.push({ start: r.start, end: r.end });
  }
  return { ok: true, ranges: merged };
}

/** Lee lo guardado en la base (jsonb) sin fiarse: lo que no cuadra, fuera. */
export function parseStoredRanges(raw: unknown): MinuteRange[] {
  if (!Array.isArray(raw)) return [];
  const list = raw
    .map((r) => ({
      start: Number((r as { start?: unknown })?.start),
      end: Number((r as { end?: unknown })?.end),
    }))
    .filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.start < r.end);
  const res = normalizeRanges(list);
  return res.ok ? res.ranges : [];
}

/** "de 9:00 a 13:00 y de 15:00 a 20:00". */
export function describeRanges(ranges: MinuteRange[]): string {
  const parts = ranges.map((r) => `de ${formatClock(r.start)} a ${formatClock(r.end)}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** ¿El rato [start, end) cae entero dentro de alguna franja? */
export function fitsInRanges(start: number, end: number, ranges: MinuteRange[]): boolean {
  return ranges.some((r) => start >= r.start && end <= r.end);
}

/** ¿Alguna franja empieza antes de las 14:00? (abre por la mañana). */
export function hasMorning(ranges: MinuteRange[]): boolean {
  return ranges.some((r) => r.start < 14 * 60);
}

/** ¿Alguna franja acaba después de las 14:00? (trabaja por la tarde). */
export function hasAfternoon(ranges: MinuteRange[]): boolean {
  return ranges.some((r) => r.end > 14 * 60);
}

export type SpecialDayForText = {
  /** 'YYYY-MM-DD' */
  day: string;
  ranges: MinuteRange[];
  professionalName?: string | null;
};

/** "viernes 21 de noviembre" para una clave 'YYYY-MM-DD'. */
export function longDayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`)
    .toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
    .replace(',', '');
}

/**
 * El párrafo que reciben los asistentes con los días especiales que vienen
 * (los de hoy en adelante). Vacío si no hay ninguno: una clínica que nunca
 * usó esto tiene exactamente el prompt de siempre. Con varios profesionales
 * se dice de quién es cada día.
 */
export function specialDaysText(days: SpecialDayForText[], todayKey: string): string {
  const upcoming = days
    .filter((d) => d.day >= todayKey && d.ranges.length > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (upcoming.length === 0) return '';
  const names = new Set(upcoming.map((d) => d.professionalName ?? ''));
  const withName = names.size > 1;
  const lines = upcoming.map((d) => {
    const who = withName && d.professionalName ? ` (${d.professionalName})` : '';
    return `- ${longDayLabel(d.day)}${who}: ${describeRanges(d.ranges)}`;
  });
  return `Días con horario especial (ese día manda este horario, no el habitual):\n${lines.join('\n')}\nSi la familia pide una hora que normalmente no abrimos (por ejemplo, por la mañana), ofrécele estos días: llama a check_availability con esa preferred_date (y su preferred_time) antes de darle una hora. No los presentes como horario habitual.`;
}

/** Clave del mapa de franjas especiales: profesional + día. */
export function specialKey(professionalId: string, dayKey: string): string {
  return `${professionalId}|${dayKey}`;
}

/** Bloque (franja) de un día especial en que cae un minuto; '' si ese día no es especial. */
export function specialSegment(
  map: Map<string, MinuteRange[]>,
  professionalId: string,
  dayKey: string,
  minute: number,
): string {
  const ranges = map.get(specialKey(professionalId, dayKey));
  if (!ranges?.length) return '';
  const idx = ranges.findIndex((r) => minute >= r.start && minute < r.end);
  return idx >= 0 ? `r${idx}` : 'fuera';
}
