/**
 * Confirmación obligatoria el día de la cita (Respinens, documento
 * "Recordatorios"). Lo puro: qué paso toca para una cita en un momento dado.
 * Los ticks del worker (`day-of-run.ts`) lo preguntan cada 5 minutos y
 * ejecutan un paso cada vez.
 *
 *   08:00  recordatorio con botones Confirmar / Modificar / Cancelar
 *   09:00  sin respuesta: segundo aviso
 *   11:00  sin respuesta: aviso al equipo para llamar
 *   12:00  sin respuesta: segundo aviso para llamar
 *   12:30  sin respuesta: la cita queda anulada y se le avisa
 *
 * Las horas son de pared, en la zona de la clínica. Nada sale para una cita
 * que ya empezó, y la anulación sólo si la cita es posterior a esa hora.
 */

export interface DayOfTimes {
  reminderAt: string;
  nudgeAt?: string;
  callAt?: string[];
  cancelAt?: string;
}

export interface DayOfState {
  reminderSentAt: Date | null;
  nudgeSentAt: Date | null;
  callsDone: number;
}

export type DayOfStep =
  | { kind: 'reminder' }
  | { kind: 'nudge' }
  | { kind: 'call'; index: number }
  | { kind: 'cancel' };

/** "08:30" → 510. */
export function clockMinutes(hhmm: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Margen tras el recordatorio antes de insistir: no se manda todo de golpe. */
const MIN_GAP_MS = 30 * 60_000;

/**
 * Siguiente paso para una cita de HOY sin confirmar, o null. `nowMinute` y
 * `startMinute` son minutos desde medianoche, hora local de la clínica.
 */
export function nextDayOfStep(args: {
  times: DayOfTimes;
  state: DayOfState;
  now: Date;
  nowMinute: number;
  startMinute: number;
}): DayOfStep | null {
  const { times, state, now, nowMinute, startMinute } = args;
  if (nowMinute >= startMinute) return null;

  const reminderAt = clockMinutes(times.reminderAt);
  if (reminderAt === null) return null;
  if (!state.reminderSentAt) return nowMinute >= reminderAt ? { kind: 'reminder' } : null;

  const waited = now.getTime() - state.reminderSentAt.getTime() >= MIN_GAP_MS;
  if (!waited) return null;

  const cancelAt = clockMinutes(times.cancelAt);
  if (cancelAt !== null && cancelAt < startMinute && nowMinute >= cancelAt) {
    return { kind: 'cancel' };
  }

  const nudgeAt = clockMinutes(times.nudgeAt);
  if (!state.nudgeSentAt && nudgeAt !== null && nowMinute >= nudgeAt) return { kind: 'nudge' };

  const calls = (times.callAt ?? []).map(clockMinutes).filter((m): m is number => m !== null);
  const nextCall = calls[state.callsDone];
  if (nextCall !== undefined && nowMinute >= nextCall) {
    return { kind: 'call', index: state.callsDone };
  }
  return null;
}

/** "esta tarde" desde las 14:00, "esta mañana" antes. */
export function whenToday(startMinute: number): string {
  return startMinute >= 14 * 60 ? 'esta tarde' : 'esta mañana';
}

export type DayOfAction = 'confirm' | 'modify' | 'cancel';

/** "1", "confirmar", "Confirmo ✅"… → acción. Sólo respuestas cortas. */
export function parseDayOfTextReply(text: string | null | undefined): DayOfAction | null {
  const t = (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
  if (!t || t.length > 20) return null;
  if (/^(1|confirmar|confirmo|confirmada|confirmado)$/.test(t)) return 'confirm';
  if (/^(2|modificar|modifico|cambiar)$/.test(t)) return 'modify';
  if (/^(3|cancelar|cancelo|anular)$/.test(t)) return 'cancel';
  return null;
}
