// Señales de conducta del paciente: la familia que duda y las banderas rojas.
//
// Respinens las llevaba como emojis en el nombre de cada contacto (🤔 para
// las que dudan, una 🚩 por cada falta o cancelación). Aquí la duda es una
// marca a mano y las banderas se CUENTAN de la agenda: un contador escrito a
// mano se desincroniza el primer día que alguien se olvida de sumarlo.
//
// Puro, sin base: lo usan la ficha, la lista de pacientes y el calendario.

export type CancelledBy = 'PATIENT' | 'CLINIC';

export interface RedFlagCounts {
  /** Citas en NO_SHOW. */
  noShows: number;
  /** Citas anuladas por la familia (o sin dato de quién). */
  cancellations: number;
  /** Las que la clínica traía de antes de la plataforma. */
  prior: number;
}

export interface PatientSignals {
  hesitant: boolean;
  hesitantNote: string | null;
  redFlags: RedFlagCounts;
}

export const EMPTY_RED_FLAGS: RedFlagCounts = { noShows: 0, cancellations: 0, prior: 0 };

/** Tope de banderas previas que se aceptan a mano (lo mismo que el CHECK). */
export const MAX_PRIOR_RED_FLAGS = 99;

/**
 * ¿Esta cita es una bandera roja? Una falta siempre; una cancelación, salvo
 * que la anulara la clínica. Sin dato de quién cancela (citas de antes de la
 * migración 0043) cuenta: así las contaba la clínica a mano.
 */
export function isRedFlagAppointment(a: {
  status: string;
  cancelledBy?: CancelledBy | string | null;
}): 'NO_SHOW' | 'CANCELLED' | null {
  if (a.status === 'NO_SHOW') return 'NO_SHOW';
  if (a.status === 'CANCELLED' && a.cancelledBy !== 'CLINIC') return 'CANCELLED';
  return null;
}

export function countRedFlags(
  appointments: { status: string; cancelledBy?: CancelledBy | string | null }[],
  prior = 0,
): RedFlagCounts {
  const out: RedFlagCounts = { noShows: 0, cancellations: 0, prior: clampPrior(prior) };
  for (const a of appointments) {
    const kind = isRedFlagAppointment(a);
    if (kind === 'NO_SHOW') out.noShows += 1;
    else if (kind === 'CANCELLED') out.cancellations += 1;
  }
  return out;
}

export function totalRedFlags(c: RedFlagCounts): number {
  return c.noShows + c.cancellations + c.prior;
}

export function clampPrior(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_PRIOR_RED_FLAGS, Math.max(0, Math.trunc(n)));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * El desglose que va en el tooltip y en la tarjeta:
 * "2 faltas · 1 cancelación · 3 anteriores". Vacío si no hay ninguna.
 */
export function describeRedFlags(c: RedFlagCounts): string {
  const parts: string[] = [];
  if (c.noShows > 0) parts.push(plural(c.noShows, 'falta', 'faltas'));
  if (c.cancellations > 0) parts.push(plural(c.cancellations, 'cancelación', 'cancelaciones'));
  if (c.prior > 0) parts.push(plural(c.prior, 'anterior', 'anteriores'));
  return parts.join(' · ');
}

/**
 * Qué tan serio es: decide el tono del indicador. 1 = aviso, 2 = cuidado,
 * 3 o más = alto.
 */
export function redFlagLevel(total: number): 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' {
  if (total <= 0) return 'NONE';
  if (total === 1) return 'LOW';
  if (total === 2) return 'MEDIUM';
  return 'HIGH';
}
