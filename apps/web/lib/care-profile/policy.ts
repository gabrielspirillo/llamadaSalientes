// Perfil de atención por clínica.
//
// Es lo que hace distinta a UNA clínica sin cambiar la plataforma para las
// demás. Una clínica de fisioterapia respiratoria pediátrica atiende a bebés
// de 0 a 4 años, necesita saber la edad exacta de cada uno, tiene una
// anamnesis propia y unas reglas de reserva que a un dentista no le dicen
// nada. Nada de eso va a un `if (tenant === …)` repartido por el código: va a
// una fila de `tenant_care_profile` que se lee aquí y, si no existe, todo se
// comporta como siempre.
//
// Este módulo es puro a propósito: sin base, sin `server-only`. Lo usan el
// servidor, los componentes del panel y los tests.

import { z } from 'zod';

import { parseDateKey } from '@/lib/tasks/tz';

export const CARE_PROFILE_KINDS = ['PEDIATRIC'] as const;
export type CareProfileKind = (typeof CARE_PROFILE_KINDS)[number];

// ─── Tutores ─────────────────────────────────────────────────────────────────

export const GUARDIAN_ROLES = ['MADRE', 'PADRE', 'NINGUNO'] as const;
export type GuardianRole = (typeof GUARDIAN_ROLES)[number];

export const GUARDIAN_ROLE_LABELS: Record<GuardianRole, string> = {
  MADRE: 'Mamá',
  PADRE: 'Papá',
  NINGUNO: 'No hay',
};

export const guardianSchema = z.object({
  role: z.enum(GUARDIAN_ROLES),
  name: z.string().trim().max(120).default(''),
});
/** Como mucho dos: mamá y papá, dos mamás, dos papás, o una sola persona. */
export const guardiansSchema = z.array(guardianSchema).max(2);
export type Guardian = z.infer<typeof guardianSchema>;

export function parseGuardians(raw: unknown): Guardian[] {
  const parsed = guardiansSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

/** "Mamá: Laura · Papá: Iván" — o "Mamá: Laura · No hay" en una familia monomarental. */
export function describeGuardians(guardians: Guardian[]): string {
  return guardians
    .map((g) =>
      g.role === 'NINGUNO'
        ? GUARDIAN_ROLE_LABELS.NINGUNO
        : `${GUARDIAN_ROLE_LABELS[g.role]}: ${g.name.trim() || '—'}`,
    )
    .join(' · ');
}

// ─── Cómo se portó en la sesión ──────────────────────────────────────────────

export const SESSION_BEHAVIORS = ['GREEN', 'YELLOW', 'RED'] as const;
export type SessionBehavior = (typeof SESSION_BEHAVIORS)[number];

export const SESSION_BEHAVIOR_LABELS: Record<SessionBehavior, string> = {
  GREEN: 'Bien',
  YELLOW: 'Regular',
  RED: 'Mal',
};

export const SESSION_BEHAVIOR_FACES: Record<SessionBehavior, string> = {
  GREEN: '🙂',
  YELLOW: '😐',
  RED: '🙁',
};

export function isSessionBehavior(value: unknown): value is SessionBehavior {
  return typeof value === 'string' && (SESSION_BEHAVIORS as readonly string[]).includes(value);
}

// ─── Anamnesis ───────────────────────────────────────────────────────────────

const anamnesisKey = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);

export const anamnesisItemSchema = z.object({
  key: anamnesisKey,
  label: z.string().trim().min(1).max(80),
  hint: z.string().trim().max(200).optional(),
});
export const anamnesisTemplateSchema = z.array(anamnesisItemSchema).max(40);
export type AnamnesisItem = z.infer<typeof anamnesisItemSchema>;

/** Sí / no / sin contestar, y el "cuál" cuando la respuesta lo pide. */
export const anamnesisAnswerSchema = z.object({
  value: z.boolean().nullable().default(null),
  detail: z.string().trim().max(500).default(''),
});
export const anamnesisAnswersSchema = z.record(anamnesisKey, anamnesisAnswerSchema);
export type AnamnesisAnswer = z.infer<typeof anamnesisAnswerSchema>;
export type AnamnesisAnswers = Record<string, AnamnesisAnswer>;

export function parseAnamnesisTemplate(raw: unknown): AnamnesisItem[] {
  const parsed = anamnesisTemplateSchema.safeParse(raw ?? []);
  return parsed.success ? parsed.data : [];
}

export function parseAnamnesisAnswers(raw: unknown): AnamnesisAnswers {
  const parsed = anamnesisAnswersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * La anamnesis contada en una línea, para los asistentes: sólo lo contestado,
 * con el detalle entre paréntesis. Lo no contestado no se nombra: "sin datos"
 * repetido trece veces no le sirve a nadie.
 */
export function describeAnamnesis(template: AnamnesisItem[], answers: AnamnesisAnswers): string {
  return template
    .map((item) => {
      const a = answers[item.key];
      if (!a || a.value === null) return null;
      const detail = a.detail.trim();
      return `${item.label}: ${a.value ? 'sí' : 'no'}${detail ? ` (${detail})` : ''}`;
    })
    .filter((s): s is string => s !== null)
    .join(' · ');
}

// ─── Reglas de reserva ───────────────────────────────────────────────────────

/**
 * Franja en la que NO se dan primeras visitas. Minutos desde medianoche en hora
 * local de la clínica y día ISO (1 = lunes), como todo el módulo Agenda: "los
 * lunes desde las 19:00" es una hora de pared y tiene que seguir siéndolo tras
 * el cambio de horario.
 */
export const firstVisitBlackoutSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  fromMinute: z.number().int().min(0).max(1440),
  toMinute: z.number().int().min(0).max(1440).default(1440),
});
export type FirstVisitBlackout = z.infer<typeof firstVisitBlackoutSchema>;

export const bookingPolicySchema = z.object({
  /** No encadenar más de N primeras visitas seguidas. Null = sin límite. */
  maxConsecutiveFirstVisits: z.number().int().min(1).max(20).nullable().default(null),
  firstVisitBlackouts: z.array(firstVisitBlackoutSchema).default([]),
  /** Edad admitida, en meses cumplidos. `max` null = sin tope. */
  patientAgeMonths: z
    .object({
      min: z.number().int().min(0).default(0),
      max: z.number().int().min(0).nullable().default(null),
    })
    .default({}),
  /** Horas de ayuno que hay que avisar antes de la sesión. Null = no aplica. */
  fastingHours: z.number().int().min(0).max(48).nullable().default(null),
  /**
   * Prioridad por edad, en meses cumplidos e inclusiva: hasta `veryHighMax`
   * es muy prioritario, hasta `highMax` prioritario. Null = sólo la marca manual.
   */
  priorityAgeMonths: z
    .object({
      veryHighMax: z.number().int().min(0),
      highMax: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  /** Hermanos que vienen juntos se agendan en huecos seguidos. */
  siblingsConsecutive: z.boolean().default(false),
});
export type BookingPolicy = z.infer<typeof bookingPolicySchema>;

export const EMPTY_BOOKING_POLICY: BookingPolicy = bookingPolicySchema.parse({});

/**
 * Una fila con claves desconocidas o valores fuera de rango no puede dejar a la
 * clínica sin agenda: se lee con los valores por defecto (= sin reglas).
 */
export function parseBookingPolicy(raw: unknown): BookingPolicy {
  const parsed = bookingPolicySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_BOOKING_POLICY;
}

export interface CareProfile {
  tenantId: string;
  profile: CareProfileKind;
  bookingPolicy: BookingPolicy;
  anamnesisTemplate: AnamnesisItem[];
  /** Lo que los asistentes preguntan y dicen en una primera visita. */
  firstVisitProtocol: string | null;
}

// ─── Edad ────────────────────────────────────────────────────────────────────

export interface Age {
  years: number;
  months: number;
  /** Días sueltos por encima de los meses cumplidos. */
  days: number;
  /** Meses cumplidos en total: es lo que comparan las reglas. */
  totalMonths: number;
}

/**
 * Edad a un día dado. Trabaja con claves 'YYYY-MM-DD' y no con instantes: un
 * cumpleaños es una fecha de calendario, no un momento, y así no depende de la
 * zona horaria del servidor.
 */
export function ageAt(birthDate: string, todayKey: string): Age | null {
  const b = parseDateKey(birthDate);
  const t = parseDateKey(todayKey);
  if (!b || !t) return null;
  if (t.year < b.year || (t.year === b.year && (t.month < b.month || (t.month === b.month && t.day < b.day)))) {
    return null;
  }

  let totalMonths = (t.year - b.year) * 12 + (t.month - b.month);
  if (t.day < b.day) totalMonths -= 1;

  // Días por encima del último mes cumplido: desde el "cumplemés" hasta hoy.
  const lastMonthly = new Date(Date.UTC(b.year, b.month - 1 + totalMonths, b.day));
  const today = new Date(Date.UTC(t.year, t.month - 1, t.day));
  const days = Math.max(0, Math.round((today.getTime() - lastMonthly.getTime()) / 86_400_000));

  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
    days,
    totalMonths,
  };
}

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/**
 * "1 año y 8 meses", "7 meses", "12 días". Es la edad con número que pide una
 * clínica pediátrica: en la agenda y en la ficha, no una fecha que haya que
 * restar de cabeza.
 */
export function describeAge(birthDate: string, todayKey: string): string | null {
  const age = ageAt(birthDate, todayKey);
  if (!age) return null;
  if (age.totalMonths < 1) return plural(age.days, 'día', 'días');
  if (age.years < 1) return plural(age.months, 'mes', 'meses');
  const years = plural(age.years, 'año', 'años');
  return age.months > 0 ? `${years} y ${plural(age.months, 'mes', 'meses')}` : years;
}

/** "de 0 a 4 años" — lo que el asistente le dice a quien pregunta por un niño mayor. */
export function describeAgeRange(policy: BookingPolicy): string | null {
  const { min, max } = policy.patientAgeMonths;
  if (max === null) return null;
  const minYears = Math.floor(min / 12);
  // 59 meses = 4 años y 11 meses: "hasta 4 años incluidos".
  const maxYears = Math.floor(max / 12);
  return `de ${minYears} a ${maxYears} años`;
}

export function isPatientAgeAllowed(ageMonths: number, policy: BookingPolicy): boolean {
  const { min, max } = policy.patientAgeMonths;
  if (ageMonths < min) return false;
  if (max !== null && ageMonths > max) return false;
  return true;
}

// ─── Prioridad ───────────────────────────────────────────────────────────────

export type PriorityLevel = 'VERY_HIGH' | 'HIGH' | 'NORMAL';

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  VERY_HIGH: 'Muy prioritario',
  HIGH: 'Prioritario',
  NORMAL: '',
};

/**
 * La prioridad sale de la edad (según el perfil) o de la marca manual. La marca
 * manual nunca baja lo que la edad ya da: un bebé de dos meses marcado a mano
 * sigue siendo muy prioritario.
 */
export function priorityLevel(
  input: { ageMonths: number | null; priorityFlag: boolean },
  policy: BookingPolicy,
): PriorityLevel {
  let level: PriorityLevel = input.priorityFlag ? 'HIGH' : 'NORMAL';
  const rule = policy.priorityAgeMonths;
  if (rule && input.ageMonths !== null) {
    if (input.ageMonths <= rule.veryHighMax) level = 'VERY_HIGH';
    else if (input.ageMonths <= rule.highMax && level === 'NORMAL') level = 'HIGH';
  }
  return level;
}

// ─── Primeras visitas ────────────────────────────────────────────────────────

/** ¿Cae este minuto local de este día en una franja sin primeras visitas? */
export function isFirstVisitBlackout(
  weekday: number,
  startMinute: number,
  policy: BookingPolicy,
): boolean {
  return policy.firstVisitBlackouts.some(
    (b) => b.weekday === weekday && startMinute >= b.fromMinute && startMinute < b.toMinute,
  );
}
