import type { MedicationInfo } from '@/lib/care-profile/policy';

/**
 * "Resumen del caso": lo que hay que recordar de un niño de un vistazo, en la
 * ficha y en el chat. Puro: recibe los datos ya leídos y decide qué se dice y
 * en qué orden (primero lo que puede hacer daño olvidar).
 */
export interface CaseSummaryInput {
  firstName: string;
  age: string | null;
  /** "Muy prioritario", "Prioritario · por edad"… o null si es normal. */
  priority: string | null;
  medication: MedicationInfo | null;
  /** "Prematuro: 34 semanas", "Alergias: proteína de leche". */
  watchouts: string[];
  /** Aviso médico pendiente de que lo valore una persona. */
  reviewReason: string | null;
  needsReview: boolean;
  /** "Mellizo de Pau", "Hermana de Lucía". */
  family: string | null;
  /** "Mamá Laura · 600 11 22 33". */
  guardians: string[];
  sessionsDone: number;
  lastSession: { when: string; diagnosis: string; nextSteps: string } | null;
  nextAppointment: string | null;
  /** "2 faltas · 1 cancelación". */
  redFlags: string | null;
  hesitant: string | null;
  consentPending: boolean;
  pendingCharges: number;
  anamnesisPending: number;
}

export type CasePointKind =
  | 'review'
  | 'medication'
  | 'watchouts'
  | 'last'
  | 'next-step'
  | 'next'
  | 'family'
  | 'guardians'
  | 'signals'
  | 'pending';

export interface CasePoint {
  kind: CasePointKind;
  tone: 'alert' | 'warn' | 'info' | 'good';
  label: string;
  text: string;
}

export interface CaseSummary {
  headline: string;
  points: CasePoint[];
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function buildCaseSummary(i: CaseSummaryInput): CaseSummary {
  const head = [i.firstName, i.age, i.priority?.toLowerCase()].filter(Boolean).join(' · ');
  const visits =
    i.sessionsDone === 0
      ? 'aún no ha venido'
      : `${i.sessionsDone} ${i.sessionsDone === 1 ? 'sesión' : 'sesiones'}${
          i.lastSession ? `, la última el ${i.lastSession.when}` : ''
        }`;
  const points: CasePoint[] = [];

  if (i.needsReview) {
    points.push({
      kind: 'review',
      tone: 'alert',
      label: 'Aviso médico sin valorar',
      text: i.reviewReason?.trim() || 'Pendiente de que lo valore una persona del equipo.',
    });
  }
  if (i.medication) {
    points.push({
      kind: 'medication',
      tone:
        i.medication.state === 'TAKES' ? 'info' : i.medication.state === 'NONE' ? 'good' : 'warn',
      label: 'Medicación',
      text: i.medication.text,
    });
  }
  if (i.watchouts.length > 0) {
    points.push({
      kind: 'watchouts',
      tone: 'alert',
      label: 'A tener en cuenta',
      text: i.watchouts.join(' · '),
    });
  }
  if (i.lastSession?.diagnosis.trim()) {
    points.push({
      kind: 'last',
      tone: 'info',
      label: `Última sesión (${i.lastSession.when})`,
      text: clip(i.lastSession.diagnosis.trim()),
    });
  }
  if (i.lastSession?.nextSteps.trim()) {
    points.push({
      kind: 'next-step',
      tone: 'info',
      label: 'Próximo paso',
      text: clip(i.lastSession.nextSteps.trim()),
    });
  }
  points.push({
    kind: 'next',
    tone: i.nextAppointment ? 'good' : 'warn',
    label: 'Próxima cita',
    text: i.nextAppointment ?? 'Sin cita reservada',
  });
  if (i.family) points.push({ kind: 'family', tone: 'info', label: 'Familia', text: i.family });
  if (i.guardians.length > 0) {
    points.push({
      kind: 'guardians',
      tone: 'info',
      label: 'Tutores',
      text: i.guardians.join('  |  '),
    });
  }
  const signals = [i.redFlags, i.hesitant].filter(Boolean).join(' · ');
  if (signals) points.push({ kind: 'signals', tone: 'warn', label: 'Ojo', text: signals });
  const pending = [
    i.anamnesisPending > 0 ? `anamnesis: ${i.anamnesisPending} sin contestar` : null,
    i.consentPending ? 'consentimiento sin firmar' : null,
    i.pendingCharges > 0
      ? `${i.pendingCharges} ${i.pendingCharges === 1 ? 'cobro pendiente' : 'cobros pendientes'}`
      : null,
  ].filter(Boolean);
  if (pending.length > 0) {
    points.push({ kind: 'pending', tone: 'warn', label: 'Pendiente', text: pending.join(' · ') });
  }

  return { headline: `${head} — ${visits}.`, points };
}
