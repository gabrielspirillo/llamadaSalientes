/**
 * ¿La hora que el modelo quiere reservar salió en la conversación? Antes de
 * `book_appointment` se comprueba que el día y la hora estén en lo que dijo la
 * familia o en lo que el asistente le ofreció. Sin esto, cuando "mañana a las
 * 16:00" no estaba libre, el modelo reservaba el jueves a las 16:00 por su
 * cuenta y después le decía a la familia que la cita era mañana.
 *
 * Puro: trabaja con claves 'YYYY-MM-DD' y texto.
 */

export const WEEKDAYS_ES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;
export const MONTHS_ES = [
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
] as const;

const NUMBER_WORDS: Record<string, number> = {
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return WEEKDAYS_ES[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? '';
}

/** "hoy", "mañana", "pasado mañana" o "el jueves 5". */
export function relativeDayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'hoy';
  if (key === addDays(todayKey, 1)) return 'mañana';
  if (key === addDays(todayKey, 2)) return 'pasado mañana';
  return `el ${weekdayOf(key)} ${Number(key.slice(8, 10))}`;
}

/** 'YYYY-MM-DD' y 'HH:MM' de lo que el modelo pasa en start_time, sin zona. */
export function splitStartTime(startTime: string): { dateKey: string; hhmm: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(startTime.trim());
  if (!m) return null;
  return { dateKey: m[1] ?? '', hhmm: `${String(Number(m[2])).padStart(2, '0')}:${m[3]}` };
}

/** El día (como lo diría la familia o el asistente) aparece en algún texto. */
export function dayMentioned(dateKey: string, texts: string[], todayKey: string): boolean {
  const day = Number(dateKey.slice(8, 10));
  const month = fold(MONTHS_ES[Number(dateKey.slice(5, 7)) - 1] ?? '');
  const weekday = fold(weekdayOf(dateKey));
  const rel = relativeDayLabel(dateKey, todayKey);
  const patterns = [
    new RegExp(`\\b${weekday}\\b`),
    new RegExp(`\\b${day} de ${month}\\b`),
    new RegExp(`\\b(el|dia) ${day}\\b`),
    new RegExp(`\\b${day}/${Number(dateKey.slice(5, 7))}\\b`),
  ];
  if (rel === 'hoy') patterns.push(/\bhoy\b/);
  if (rel === 'mañana') patterns.push(/(?<!por la |de la |esta |la )\bmanana\b/);
  if (rel === 'pasado mañana') patterns.push(/\bpasado manana\b/);
  return texts.some((t) => {
    const f = fold(t);
    return patterns.some((re) => re.test(f));
  });
}

/** "16:00", "16h", "a las 4", "las cuatro", "4 y media"… en algún texto. */
export function timeMentioned(hhmm: string, texts: string[]): boolean {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const min = Number(mStr);
  const hours = [h, h > 12 ? h - 12 : h === 0 ? 12 : h].filter((v, i, a) => a.indexOf(v) === i);
  const suffix =
    min === 0 ? '(?!:[1-5])' : min === 30 ? ' y media' : min === 15 ? ' y cuarto' : null;
  const patterns: RegExp[] = [];
  for (const hh of hours) {
    const words = Object.entries(NUMBER_WORDS)
      .filter(([, v]) => v === hh)
      .map(([w]) => w);
    const hAlt = `(${[String(hh), String(hh).padStart(2, '0'), ...words].join('|')})`;
    patterns.push(new RegExp(`\\b${hAlt}[:.h]${String(min).padStart(2, '0')}\\b`));
    patterns.push(new RegExp(`\\b${hAlt}[:.]${String(min).padStart(2, '0')}\\b`));
    if (suffix !== null) {
      patterns.push(new RegExp(`\\b(a las|las|a la|la) ${hAlt}${suffix}\\b`));
      if (min === 0) patterns.push(new RegExp(`\\b${hAlt} ?h\\b`));
    }
  }
  return texts.some((t) => {
    const f = fold(t);
    return patterns.some((re) => re.test(f));
  });
}

/**
 * Resultado de la comprobación antes de reservar. `null` = adelante.
 */
export function slotNotOffered(
  startTime: string,
  texts: string[],
  todayKey: string,
): { dateKey: string; hhmm: string; missing: 'day' | 'time' } | null {
  const parts = splitStartTime(startTime);
  if (!parts) return null;
  if (!dayMentioned(parts.dateKey, texts, todayKey)) return { ...parts, missing: 'day' };
  if (!timeMentioned(parts.hhmm, texts)) return { ...parts, missing: 'time' };
  return null;
}

/** Última fecha confirmada por la clínica en el chat ("🗓️ Jueves, 5 de noviembre"). */
export function lastConfirmedDate(assistantTexts: string[], todayKey: string): string | null {
  for (let i = assistantTexts.length - 1; i >= 0; i--) {
    const m = /🗓️\s*\p{L}+,?\s*(\d{1,2}) de (\p{L}+)/u.exec(assistantTexts[i] ?? '');
    if (!m) continue;
    const month = MONTHS_ES.findIndex((x) => fold(x) === fold(m[2] ?? ''));
    if (month < 0) continue;
    let year = Number(todayKey.slice(0, 4));
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    // Una fecha de hace más de un mes es del año que viene.
    if (key < addDays(todayKey, -31)) year += 1;
    return `${year}${key.slice(4)}`;
  }
  return null;
}

/** El texto dice "mañana"/"hoy" (como día, no "por la mañana") para una cita. */
export function relativeDayInText(text: string): 'hoy' | 'mañana' | 'pasado mañana' | null {
  const f = fold(text);
  if (/\bpasado manana\b/.test(f)) return 'pasado mañana';
  if (/(?<!por la |de la |esta |la |las )\bmanana\b/.test(f)) return 'mañana';
  if (/\bhoy\b/.test(f)) return 'hoy';
  return null;
}
