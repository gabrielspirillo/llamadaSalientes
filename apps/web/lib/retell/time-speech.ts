// Convierte horas a texto deletreado en español para que el TTS de Retell
// las pronuncie naturalmente ("nueve y media de la mañana" en vez de "09:30").
// El LLM recibe el texto ya hablado y lo repite tal cual al paciente.

const HOUR_NAMES = [
  'doce', 'una', 'dos', 'tres', 'cuatro', 'cinco',
  'seis', 'siete', 'ocho', 'nueve', 'diez', 'once',
];

const MINUTE_NAMES: Record<number, string> = {
  0: '',
  5: 'y cinco',
  10: 'y diez',
  15: 'y cuarto',
  20: 'y veinte',
  25: 'y veinticinco',
  30: 'y media',
  35: 'y treinta y cinco',
  40: 'y cuarenta',
  45: 'y cuarenta y cinco',
  50: 'y cincuenta',
  55: 'y cincuenta y cinco',
};

function dayPart(hour24: number): string {
  if (hour24 >= 5 && hour24 < 12) return 'de la mañana';
  if (hour24 === 12) return 'del mediodía';
  if (hour24 >= 13 && hour24 < 20) return 'de la tarde';
  return 'de la noche';
}

function speakHourMinute(hour24: number, minute: number): string {
  const h = ((hour24 % 24) + 24) % 24;
  const m = Math.max(0, Math.min(59, minute));
  const hourName = HOUR_NAMES[h % 12];
  const minPart = MINUTE_NAMES[m] ?? `y ${m}`;
  return [hourName, minPart, dayPart(h)].filter(Boolean).join(' ');
}

// Devuelve la hora deletreada de un Date interpretado en la timezone indicada.
export function speakClockTime(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return speakHourMinute(hour, minute);
}

// Recibe "HH:MM" (24h, sin zona) y devuelve la hora deletreada.
export function speakHHMM(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number.parseInt(hStr ?? '', 10);
  const m = Number.parseInt(mStr ?? '', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return speakHourMinute(h, m);
}

// "09:00" + "18:00" → "de nueve de la mañana a seis de la tarde".
export function speakWorkingHoursRange(open: string, close: string): string {
  return `de ${speakHHMM(open)} a ${speakHHMM(close)}`;
}

// Devuelve el artículo correcto ("a la" para la una, "a las" para el resto).
export function clockArticle(spokenTime: string): 'a la' | 'a las' {
  return spokenTime.startsWith('una ') ? 'a la' : 'a las';
}
