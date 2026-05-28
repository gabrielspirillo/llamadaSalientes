// Predicados puros para matching paciente ↔ slot liberado.
// Sin I/O — testeables directamente.

export type WaitlistEntryForMatching = {
  treatmentId: string | null;
  assignedDentistId: string | null;
  originalStartTime: Date;
  preferredTimeWindowStart: string | null; // "HH:MM" en zona clínica
  preferredTimeWindowEnd: string | null;
};

export type SlotForMatching = {
  treatmentId: string | null;
  assignedDentistId: string | null; // del slot original cancelado
  startTime: Date;
  endTime: Date | null;
  treatmentDurationMinutes: number | null;
};

export type MatchSettings = {
  minAdvanceDays: number;
  requireSameDentist: boolean;
  respectTimeWindow: boolean;
  clinicTimezone: string;
};

export function sameTreatment(entry: WaitlistEntryForMatching, slot: SlotForMatching): boolean {
  if (!entry.treatmentId || !slot.treatmentId) return false;
  return entry.treatmentId === slot.treatmentId;
}

export function slotIsEarlierEnoughThanEntry(
  entry: WaitlistEntryForMatching,
  slot: SlotForMatching,
  minAdvanceDays: number,
): boolean {
  const advanceMs = entry.originalStartTime.getTime() - slot.startTime.getTime();
  if (advanceMs <= 0) return false;
  const minMs = minAdvanceDays * 24 * 60 * 60 * 1000;
  return advanceMs >= minMs;
}

export function durationFits(slot: SlotForMatching): boolean {
  if (!slot.treatmentDurationMinutes) return true; // si no conocemos duración, no bloqueamos
  if (!slot.endTime) return true;
  const slotMs = slot.endTime.getTime() - slot.startTime.getTime();
  if (slotMs <= 0) return false;
  return slotMs >= slot.treatmentDurationMinutes * 60 * 1000;
}

export function sameDentist(entry: WaitlistEntryForMatching, slot: SlotForMatching): boolean {
  if (!entry.assignedDentistId || !slot.assignedDentistId) return false;
  return entry.assignedDentistId === slot.assignedDentistId;
}

// Convierte un Date a "HH:MM" en la timezone dada usando Intl. Resultado en h23.
function formatHHMM(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).format(d);
}

// Compara "HH:MM" léxicamente — válido porque h23 es zero-padded.
export function withinTimeWindow(
  entry: WaitlistEntryForMatching,
  slot: SlotForMatching,
  tz: string,
): boolean {
  const start = entry.preferredTimeWindowStart;
  const end = entry.preferredTimeWindowEnd;
  if (!start || !end) return true; // sin ventana → no bloquea
  const slotHHMM = formatHHMM(slot.startTime, tz);
  return slotHHMM >= start && slotHHMM <= end;
}

export type MatchDecision = { eligible: true } | { eligible: false; reason: string };

export function evaluateMatch(
  entry: WaitlistEntryForMatching,
  slot: SlotForMatching,
  settings: MatchSettings,
): MatchDecision {
  if (!sameTreatment(entry, slot)) return { eligible: false, reason: 'treatment_mismatch' };
  if (!durationFits(slot)) return { eligible: false, reason: 'duration_insufficient' };
  if (!slotIsEarlierEnoughThanEntry(entry, slot, settings.minAdvanceDays)) {
    return { eligible: false, reason: 'slot_not_earlier' };
  }
  if (settings.requireSameDentist && !sameDentist(entry, slot)) {
    return { eligible: false, reason: 'different_dentist' };
  }
  if (settings.respectTimeWindow && !withinTimeWindow(entry, slot, settings.clinicTimezone)) {
    return { eligible: false, reason: 'outside_time_window' };
  }
  return { eligible: true };
}
