// Parser de la barra de alta rápida.
//
// La recepcionista no va a abrir un formulario de nueve campos entre paciente
// y paciente. Escribe una línea y sigue:
//
//   "Llamar a María mañana 10:30 #paciente !alta"
//
// Puro y sin dependencias: se testea directo y corre en el cliente para
// previsualizar lo que se va a crear antes de enviarlo.

import type { TaskCategory, TaskPriority } from '@/lib/tasks/constants';

export interface QuickParseResult {
  title: string;
  category: TaskCategory | null;
  priority: TaskPriority | null;
  dueAt: Date | null;
  dueAllDay: boolean;
  /** Textos sueltos tras `@` — el cliente los matchea contra los miembros. */
  assigneeHints: string[];
  labels: string[];
}

const CATEGORY_WORDS: Record<string, TaskCategory> = {
  paciente: 'PATIENT',
  pacientes: 'PATIENT',
  gabinete: 'CLINICAL',
  clinica: 'CLINICAL',
  clínica: 'CLINICAL',
  esterilizacion: 'CLINICAL',
  esterilización: 'CLINICAL',
  admin: 'ADMIN',
  administracion: 'ADMIN',
  administración: 'ADMIN',
  caja: 'ADMIN',
  cumplimiento: 'COMPLIANCE',
  legal: 'COMPLIANCE',
  rgpd: 'COMPLIANCE',
  equipo: 'TEAM',
  formacion: 'TEAM',
  formación: 'TEAM',
  marketing: 'MARKETING',
  resenas: 'MARKETING',
  reseñas: 'MARKETING',
};

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  urgente: 'URGENT',
  urgent: 'URGENT',
  alta: 'HIGH',
  alto: 'HIGH',
  media: 'MEDIUM',
  medio: 'MEDIUM',
  normal: 'MEDIUM',
  baja: 'LOW',
  bajo: 'LOW',
};

const WEEKDAY_WORDS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
  domingo: 7,
};

export function parseQuickTask(raw: string, now: Date = new Date()): QuickParseResult {
  let text = ` ${raw} `;
  const result: QuickParseResult = {
    title: '',
    category: null,
    priority: null,
    dueAt: null,
    dueAllDay: true,
    assigneeHints: [],
    labels: [],
  };

  // ── #categoria / #etiqueta ────────────────────────────────────────────────
  text = text.replace(/(^|\s)#([\p{L}\d_-]+)/giu, (_m, pre: string, word: string) => {
    const key = word.toLowerCase();
    const cat = CATEGORY_WORDS[key];
    if (cat && !result.category) result.category = cat;
    else result.labels.push(word);
    return pre;
  });

  // ── !prioridad (o !, !!, !!!) ─────────────────────────────────────────────
  text = text.replace(/(^|\s)!{1,3}([\p{L}]*)/giu, (m, pre: string, word: string) => {
    const bangs = (m.match(/!/g) ?? []).length;
    const key = word.toLowerCase();
    if (key && PRIORITY_WORDS[key]) {
      result.priority = PRIORITY_WORDS[key];
    } else if (!key) {
      result.priority = bangs >= 3 ? 'URGENT' : bangs === 2 ? 'HIGH' : 'MEDIUM';
    } else {
      return m; // "!" pegado a una palabra que no es prioridad: se respeta.
    }
    return pre;
  });

  // ── @persona ──────────────────────────────────────────────────────────────
  text = text.replace(/(^|\s)@([\p{L}\d._-]+)/giu, (_m, pre: string, word: string) => {
    result.assigneeHints.push(word);
    return pre;
  });

  // ── Hora explícita ────────────────────────────────────────────────────────
  let hour: number | null = null;
  let minute = 0;
  text = text.replace(
    /(^|\s)(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(h|hs|hrs)?(?=\s|$)/giu,
    (m, pre: string, hh: string, mm: string | undefined, suffix: string | undefined) => {
      // Solo lo tomamos como hora si trae ":" o sufijo "h": un "20" suelto
      // en "llamar al 20" no es una hora.
      if (hour !== null) return m;
      if (!mm && !suffix) return m;
      const h = Number(hh);
      if (h > 23) return m;
      hour = h;
      minute = mm ? Math.min(59, Number(mm)) : 0;
      return pre;
    },
  );

  // ── Fecha ─────────────────────────────────────────────────────────────────
  let dueDate: Date | null = null;

  const consume = (re: RegExp, fn: (m: RegExpMatchArray) => Date | null): void => {
    if (dueDate) return;
    const m = re.exec(text);
    if (!m) return;
    const d = fn(m);
    if (d) {
      dueDate = d;
      text = text.replace(re, ' ');
    }
  };

  consume(/(^|\s)pasado\s+ma(?:ñ|n)ana(?=\s|$)/iu, () => addDays(startOfDay(now), 2));
  consume(/(^|\s)ma(?:ñ|n)ana(?=\s|$)/iu, () => addDays(startOfDay(now), 1));
  consume(/(^|\s)hoy(?=\s|$)/iu, () => startOfDay(now));
  consume(/(^|\s)en\s+(\d{1,2})\s+d(?:í|i)as?(?=\s|$)/iu, (m) =>
    addDays(startOfDay(now), Number(m[2] ?? 1)),
  );
  consume(
    /(^|\s)(?:el\s+)?(lunes|martes|mi(?:é|e)rcoles|jueves|viernes|s(?:á|a)bado|domingo)(?=\s|$)/iu,
    (m) => nextWeekday(now, WEEKDAY_WORDS[(m[2] ?? '').toLowerCase()] ?? 1),
  );
  consume(/(^|\s)(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?=\s|$)/u, (m) => {
    const day = Number(m[2]);
    const month = Number(m[3]);
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    let year = m[4] ? Number(m[4]) : now.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day, 0, 0, 0, 0);
    // Sin año explícito y ya pasó → se entiende el año que viene.
    if (!m[4] && d.getTime() < startOfDay(now).getTime()) d.setFullYear(year + 1);
    return d;
  });

  if (hour !== null && !dueDate) dueDate = startOfDay(now);
  if (dueDate) {
    if (hour !== null) {
      dueDate.setHours(hour, minute, 0, 0);
      result.dueAllDay = false;
      // "a las 9" cuando ya son las 18 se entiende como mañana.
      if (dueDate.getTime() < now.getTime() && sameDay(dueDate, now)) {
        dueDate = addDays(dueDate, 1);
      }
    } else {
      dueDate.setHours(18, 0, 0, 0);
      result.dueAllDay = true;
    }
    result.dueAt = dueDate;
  }

  result.title = text.replace(/\s+/g, ' ').trim();
  return result;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, days: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Próximo día de la semana (ISO 1-7). Si hoy es ese día, devuelve el de la semana que viene. */
function nextWeekday(now: Date, targetIso: number): Date {
  const base = startOfDay(now);
  const currentIso = base.getDay() === 0 ? 7 : base.getDay();
  let delta = targetIso - currentIso;
  if (delta <= 0) delta += 7;
  return addDays(base, delta);
}
