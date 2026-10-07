// Qué cita quiere anular el paciente, a partir de lo que dice ("la de Lucas",
// "la del martes"). Puro, sin base: lo usa `agendaCancelByPatient` y los tests.
//
// Nunca se busca por nombre en toda la clínica: las candidatas son siempre las
// citas del teléfono que escribe o llama. Si no, cualquiera podría anular la
// cita de otro sabiendo cómo se llama.

import { foldSearchText } from '@/lib/patients/search-text';
import { localDateKey } from '@/lib/tasks/tz';

export interface CancelCandidate {
  id: string;
  patientName: string;
  startsAt: Date;
}

/**
 * Filtra las citas próximas del teléfono por nombre (todas las palabras dichas,
 * sin tildes, en cualquier orden) y por día local. Un filtro que deja la lista
 * vacía se ignora si es el nombre: el paciente suele decir su propio nombre y
 * la cita puede estar a nombre del niño, así que vale más preguntar cuál que
 * decir que no hay ninguna.
 */
export function pickAppointmentsToCancel<T extends CancelCandidate>(
  candidates: T[],
  opts: { patientName?: string | null; dateKey?: string | null; timezone: string },
): T[] {
  let out = candidates;

  const day = opts.dateKey?.trim();
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    out = out.filter((c) => localDateKey(c.startsAt, opts.timezone) === day);
  }

  const words = foldSearchText(opts.patientName ?? '')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (words.length > 0) {
    const byName = out.filter((c) => {
      const name = foldSearchText(c.patientName);
      return words.some((w) => name.includes(w));
    });
    if (byName.length > 0) out = byName;
  }

  return out;
}
