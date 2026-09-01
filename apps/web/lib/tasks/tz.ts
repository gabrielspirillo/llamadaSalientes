// Utilidades de fecha con timezone de la clínica.
//
// Sin dependencias: una rutina "apertura 08:30" tiene que caer a las 08:30 de
// Madrid aunque el worker corra en UTC, y tiene que seguir cayendo a las 08:30
// después del cambio de horario. Todo lo que sigue es puro y testeable.

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** ISO: 1 = lunes … 7 = domingo. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function formatterFor(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
}

/** Descompone un instante en sus partes de calendario en `tz`. */
export function localParts(date: Date, tz: string): LocalParts {
  const parts = formatterFor(tz).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 1,
  };
}

/** Offset de la zona respecto de UTC, en ms, para ese instante concreto. */
export function tzOffsetMs(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const secs = Number(
    formatterFor(tz)
      .formatToParts(date)
      .find((x) => x.type === 'second')?.value ?? '0',
  );
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, secs);
  // Los ms no los da el formatter: se los devolvemos para no perder precisión.
  return asUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Construye el instante UTC que corresponde a una hora de pared en `tz`.
 * Doble pasada porque el offset depende del propio instante (DST).
 */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let result = guess - tzOffsetMs(new Date(guess), tz);
  // Segunda pasada: si el primer guess cayó del otro lado de un salto DST.
  result = guess - tzOffsetMs(new Date(result), tz);
  return new Date(result);
}

/** 'YYYY-MM-DD' del día local en `tz`. Es la clave de dedupe de las rutinas. */
export function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Suma días a una clave 'YYYY-MM-DD' sin tocar zonas horarias. */
export function addDaysToKey(key: string, days: number): string {
  const p = parseDateKey(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** Días enteros entre dos claves (b - a). */
export function daysBetweenKeys(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  if (!pa || !pb) return 0;
  const ms = Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day);
  return Math.round(ms / 86_400_000);
}

/** ISO weekday (1=lunes) de una clave 'YYYY-MM-DD'. */
export function weekdayOfKey(key: string): number {
  const p = parseDateKey(key);
  if (!p) return 1;
  const js = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0=domingo
  return js === 0 ? 7 : js;
}

/** 'HH:MM' → { hour, minute }. Tolera basura y cae en 09:00. */
export function parseTimeOfDay(value: string | null | undefined): {
  hour: number;
  minute: number;
} {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!m) return { hour: 9, minute: 0 };
  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));
  return { hour, minute };
}
