// Lo que la plataforma le ahorra y le hace ganar a la clínica: reglas puras,
// sin base de datos, con tests (tests/unit/panel-valor.test.ts).
//
// Las HORAS son una estimación y el panel lo dice: lo medido es cuántas cosas
// hizo la plataforma sola; los minutos por cosa son lo que le costaría a una
// persona de recepción hacerlas a mano (conservador a propósito).

export const MINUTES_PER = {
  /** Leer el mensaje y escribir la respuesta. */
  reply: 1.5,
  /** Mirar la agenda, buscar hueco y apuntar la cita. */
  booking: 3,
  /** Mandar un recordatorio o insistir para que confirmen. */
  reminder: 2,
  /** Buscar a quién ofrecerle un hueco libre y escribirle. */
  offer: 3,
} as const;

export type SavingKey = keyof typeof MINUTES_PER;

export type SavingPart = { key: SavingKey; label: string; count: number; minutes: number };

const LABELS: Record<SavingKey, string> = {
  reply: 'Respondiendo WhatsApp',
  booking: 'Dando citas',
  reminder: 'Recordatorios y confirmaciones',
  offer: 'Ofreciendo huecos libres',
};

/** Una jornada de recepción, para traducir horas a algo que se entiende. */
export const WORKDAY_MINUTES = 8 * 60;

export function estimateSavings(counts: Record<SavingKey, number>): {
  totalMinutes: number;
  parts: SavingPart[];
} {
  const parts = (Object.keys(MINUTES_PER) as SavingKey[]).map((key) => {
    const count = Math.max(0, Math.round(counts[key] ?? 0));
    return { key, label: LABELS[key], count, minutes: count * MINUTES_PER[key] };
  });
  return { totalMinutes: parts.reduce((s, p) => s + p.minutes, 0), parts };
}

/** "≈ 4 jornadas de recepción" (media jornada hacia arriba; '' si no llega a media). */
export function workdaysLabel(minutes: number): string {
  const days = Math.round((minutes / WORKDAY_MINUTES) * 2) / 2;
  if (days < 0.5) return '';
  const n = Number.isInteger(days) ? String(days) : days.toLocaleString('es-ES');
  return `≈ ${n} ${days === 1 ? 'jornada' : 'jornadas'} de recepción`;
}

export type RecoveredOffer = { answeredAt: Date; cents: number | null };

/**
 * Dinero de los huecos que se volvieron a llenar con una oferta aceptada. Una
 * oferta sin precio conocido (cita sin cobro ni tratamiento con precio) vale
 * el precio medio de la clínica: contarla como 0 escondería el hueco.
 */
export function summarizeRecovered(
  offers: RecoveredOffer[],
  opts: { fallbackCents: number; monthStart: Date; weekStarts: Date[] },
): {
  monthCents: number;
  monthCount: number;
  totalCents: number;
  totalCount: number;
  weekly: number[];
} {
  const value = (o: RecoveredOffer) =>
    o.cents != null && o.cents > 0 ? o.cents : Math.max(0, opts.fallbackCents);
  let monthCents = 0;
  let monthCount = 0;
  let totalCents = 0;
  const weekly = opts.weekStarts.map(() => 0);
  for (const o of offers) {
    const v = value(o);
    totalCents += v;
    if (o.answeredAt >= opts.monthStart) {
      monthCents += v;
      monthCount += 1;
    }
    // weekStarts va de la más antigua a la actual.
    for (let i = opts.weekStarts.length - 1; i >= 0; i--) {
      const start = opts.weekStarts[i];
      if (start && o.answeredAt >= start) {
        if (i === opts.weekStarts.length - 1 || o.answeredAt < (opts.weekStarts[i + 1] as Date)) {
          weekly[i] = (weekly[i] ?? 0) + v;
        }
        break;
      }
    }
  }
  return { monthCents, monthCount, totalCents, totalCount: offers.length, weekly };
}

/** De cada 10 citas, cuántas dio el asistente (redondeado; 0 si no hay citas). */
export function outOfTen(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(10, Math.max(1, Math.round((part / total) * 10)));
}
