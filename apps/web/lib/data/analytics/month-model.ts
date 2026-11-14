// El mes de la clínica frente al anterior y la semana que viene: reglas puras,
// sin base de datos, con tests (tests/unit/panel-mes.test.ts).

export type SessionRow = {
  /** Día local de la sesión, 'YYYY-MM-DD'. */
  dayKey: string;
  /** Lo cobrado en esa cita o el precio de su tratamiento; null si no se sabe. */
  cents: number | null;
  firstVisit: boolean;
};

export function daysInMonth(monthKey: string): number {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Sesiones atendidas, familias nuevas e ingresos de este mes frente al
 * anterior: el mes entero (la meta de los anillos) y el mismo punto del mes
 * (la comparación justa: el día 14 contra el 14). Una sesión sin precio
 * conocido vale el precio medio de la clínica.
 */
export function summarizeMonth(
  rows: SessionRow[],
  opts: {
    monthStartKey: string;
    prevMonthStartKey: string;
    todayKey: string;
    fallbackCents: number;
  },
) {
  const todayDay = Number(opts.todayKey.slice(8, 10));
  const prevDays = daysInMonth(opts.prevMonthStartKey);
  const thisDaily = Array.from({ length: todayDay }, () => 0);
  const prevDaily = Array.from({ length: prevDays }, () => 0);
  const s = { month: 0, prevSame: 0, prevTotal: 0 };
  const f = { month: 0, prevSame: 0, prevTotal: 0 };
  const value = (r: SessionRow) =>
    r.cents != null && r.cents > 0 ? r.cents : Math.max(0, opts.fallbackCents);

  for (const r of rows) {
    const day = Number(r.dayKey.slice(8, 10));
    if (r.dayKey >= opts.monthStartKey) {
      if (r.dayKey > opts.todayKey) continue;
      s.month += 1;
      if (r.firstVisit) f.month += 1;
      thisDaily[day - 1] = (thisDaily[day - 1] ?? 0) + value(r);
    } else if (r.dayKey >= opts.prevMonthStartKey) {
      s.prevTotal += 1;
      if (r.firstVisit) f.prevTotal += 1;
      if (day <= todayDay) {
        s.prevSame += 1;
        if (r.firstVisit) f.prevSame += 1;
      }
      prevDaily[day - 1] = (prevDaily[day - 1] ?? 0) + value(r);
    }
  }

  const cumulative = (xs: number[]) => {
    let acc = 0;
    return xs.map((x) => {
      acc += x;
      return acc;
    });
  };
  const cumThis = cumulative(thisDaily);
  const cumPrev = cumulative(prevDaily);
  return {
    sessions: s,
    firstVisits: f,
    revenue: {
      monthCents: cumThis[cumThis.length - 1] ?? 0,
      prevSameCents: cumPrev[Math.min(todayDay, prevDays) - 1] ?? 0,
      prevTotalCents: cumPrev[cumPrev.length - 1] ?? 0,
      cumThis,
      cumPrev,
    },
  };
}

export type MonthSummary = ReturnType<typeof summarizeMonth>;

/** Variación en % redondeada; null si no hay base con la que comparar. */
export function changePct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Lo que llena un anillo: 0–1, y lleno si no hay meta pero sí actividad. */
export function ringProgress(value: number, goal: number): number {
  if (goal <= 0) return value > 0 ? 1 : 0;
  return Math.max(0, Math.min(1, value / goal));
}

/* ── La semana que viene ────────────────────────────────────────────────── */

export type MinuteRange = { start: number; end: number };

export type WeekDay = {
  dayKey: string;
  /** 'L', 'M', 'X'… */
  letter: string;
  dayNumber: number;
  count: number;
  firstVisits: number;
  bookedMinutes: number;
  shiftMinutes: number;
  /** "15:00", hora de la primera cita; null sin citas. */
  firstTime: string | null;
  /** Ni horario ni citas: la clínica no abre. */
  closed: boolean;
};

const LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Días de la semana que viene con sus citas y su horario. `weekdayOf` da el
 * día ISO (1 = lunes) de una clave; `specials` manda sobre el horario semanal
 * de ese profesional ese día (los días con horario especial).
 */
export function buildWeekStrip(input: {
  dayKeys: string[];
  weekdayOf: (dayKey: string) => number;
  appointments: { dayKey: string; startMinute: number; minutes: number; firstVisit: boolean }[];
  shifts: { professionalId: string; weekday: number; startMinute: number; endMinute: number }[];
  specials: Map<string, MinuteRange[]>;
}): WeekDay[] {
  const professionals = [...new Set(input.shifts.map((s) => s.professionalId))];
  for (const key of input.specials.keys()) {
    const pid = key.split('|')[0] ?? '';
    if (pid && !professionals.includes(pid)) professionals.push(pid);
  }
  return input.dayKeys.map((dayKey) => {
    const weekday = input.weekdayOf(dayKey);
    let shiftMinutes = 0;
    for (const pid of professionals) {
      const special = input.specials.get(`${pid}|${dayKey}`);
      if (special?.length) {
        shiftMinutes += special.reduce((a, r) => a + Math.max(0, r.end - r.start), 0);
      } else {
        for (const s of input.shifts) {
          if (s.professionalId === pid && s.weekday === weekday) {
            shiftMinutes += Math.max(0, s.endMinute - s.startMinute);
          }
        }
      }
    }
    const appts = input.appointments.filter((a) => a.dayKey === dayKey);
    const first = appts.reduce<number | null>(
      (m, a) => (m == null || a.startMinute < m ? a.startMinute : m),
      null,
    );
    return {
      dayKey,
      letter: LETTERS[weekday - 1] ?? '',
      dayNumber: Number(dayKey.slice(8, 10)),
      count: appts.length,
      firstVisits: appts.filter((a) => a.firstVisit).length,
      bookedMinutes: appts.reduce((a, x) => a + x.minutes, 0),
      shiftMinutes,
      firstTime: first == null ? null : clock(first),
      closed: shiftMinutes === 0 && appts.length === 0,
    };
  });
}

/** Horas libres de la semana (lo que queda del horario sin citas). */
export function freeMinutes(week: WeekDay[]): number {
  return week.reduce((a, d) => a + Math.max(0, d.shiftMinutes - d.bookedMinutes), 0);
}
