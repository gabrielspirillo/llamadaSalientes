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

export const GUARDIAN_ROLES = [
  'MADRE',
  'PADRE',
  'ABUELA',
  'ABUELO',
  'TUTOR',
  'OTRO',
  'NINGUNO',
] as const;
export type GuardianRole = (typeof GUARDIAN_ROLES)[number];

export const GUARDIAN_ROLE_LABELS: Record<GuardianRole, string> = {
  MADRE: 'Mamá',
  PADRE: 'Papá',
  ABUELA: 'Abuela',
  ABUELO: 'Abuelo',
  TUTOR: 'Tutor/a legal',
  OTRO: 'Otro',
  NINGUNO: 'No hay',
};

export const CONTACT_CHANNELS = ['WHATSAPP', 'CALL'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  WHATSAPP: 'WhatsApp',
  CALL: 'Llamada',
};

/**
 * Un tutor: quién es para el niño, cómo se llama y cómo se le localiza. El
 * marcado como `primary` es el titular del teléfono de la ficha: a él se le
 * llama, se le escribe y se le manda el consentimiento.
 */
export const guardianSchema = z.object({
  role: z.enum(GUARDIAN_ROLES),
  name: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  channel: z.enum(CONTACT_CHANNELS).nullable().optional(),
  primary: z.boolean().optional(),
});
/** Hasta cuatro: madre, padre, abuela que trae al niño, tutor legal. */
export const guardiansSchema = z.array(guardianSchema).max(4);
export type Guardian = z.infer<typeof guardianSchema>;

/** Los tutores que existen: con nombre o teléfono y no marcados como "no hay". */
export function activeGuardians(guardians: Guardian[]): Guardian[] {
  return guardians.filter(
    (g) => g.role !== 'NINGUNO' && (g.name.trim() !== '' || (g.phone?.trim() ?? '') !== ''),
  );
}

/** El titular del teléfono, si alguien lo es. */
export function primaryGuardian(guardians: Guardian[]): Guardian | null {
  return activeGuardians(guardians).find((g) => g.primary) ?? null;
}

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
  /** Texto guía del "¿cuál?": qué se espera que se anote. */
  hint: z.string().trim().max(200).optional(),
  /** Nombre completo de una sigla (RGE → Reflujo gastroesofágico). */
  fullName: z.string().trim().max(120).optional(),
  /** Bloque de la pestaña: Antecedentes médicos, Perinatal, Entorno… */
  group: z.string().trim().max(60).optional(),
  /**
   * Un "sí" en este ítem sale en la línea "A tener en cuenta" de la cabecera
   * de la ficha (prematuro, ingresos, alergias…). Lo decide la plantilla de
   * la clínica, no el código.
   */
  alert: z.boolean().optional(),
  /** Un "sí" aquí no cuadra con un "sí" en un ítem de alerta ("Sano"). */
  exclusive: z.boolean().optional(),
  /** A este ítem no se le pregunta "¿cuál?". */
  noDetail: z.boolean().optional(),
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

export interface WatchoutItem {
  key: string;
  label: string;
  detail: string | null;
  source: 'ANAMNESIS' | 'PRIORITY';
}

/**
 * Lo que hay que tener presente al atender: los "sí" de los ítems marcados
 * como alerta en la plantilla, con su detalle, más el motivo de la prioridad
 * manual si lo hay. Es el banner de alertas de la ficha. Vacío = nada anotado.
 */
export function describeWatchouts(
  template: AnamnesisItem[],
  answers: AnamnesisAnswers,
  extra: { priorityFlag?: boolean; priorityReason?: string | null } = {},
): WatchoutItem[] {
  const out: WatchoutItem[] = [];
  if (extra.priorityFlag && extra.priorityReason?.trim()) {
    out.push({
      key: 'priority',
      label: 'Prioritario',
      detail: extra.priorityReason.trim(),
      source: 'PRIORITY',
    });
  }
  for (const item of template) {
    if (!item.alert) continue;
    const a = answers[item.key];
    if (!a || a.value !== true) continue;
    const detail = a.detail.trim();
    out.push({ key: item.key, label: item.label, detail: detail || null, source: 'ANAMNESIS' });
  }
  return out;
}

/** "Prematuro: 34 semanas" o "Ingresos". */
export function formatWatchout(item: WatchoutItem): string {
  return item.detail ? `${item.label}: ${item.detail}` : item.label;
}

/**
 * Contradicciones que se pueden detectar sin saber medicina: un "sí" en un
 * ítem `exclusive` ("Sano") junto a un "sí" en un ítem de alerta. Avisa, no
 * bloquea: quien contesta decide.
 */
export function anamnesisConflicts(template: AnamnesisItem[], answers: AnamnesisAnswers): string[] {
  const yes = (key: string) => answers[key]?.value === true;
  const out: string[] = [];
  for (const excl of template) {
    if (!excl.exclusive || !yes(excl.key)) continue;
    const clashes = template.filter((i) => i.alert && i.key !== excl.key && yes(i.key));
    if (clashes.length === 0) continue;
    out.push(
      `"${excl.label}: sí" no cuadra con ${clashes.map((c) => `"${c.label}: sí"`).join(' ni ')}.`,
    );
  }
  return out;
}

export interface AnamnesisGroup {
  /** Null = ítems sin bloque (plantillas antiguas). */
  group: string | null;
  items: AnamnesisItem[];
}

/** Los ítems por bloque, en el orden en que cada bloque aparece por primera vez. */
export function groupAnamnesis(template: AnamnesisItem[]): AnamnesisGroup[] {
  const out: AnamnesisGroup[] = [];
  for (const item of template) {
    const group = item.group?.trim() || null;
    let bucket = out.find((g) => g.group === group);
    if (!bucket) {
      bucket = { group, items: [] };
      out.push(bucket);
    }
    bucket.items.push(item);
  }
  return out;
}

/**
 * "Laura · Iván": sólo los nombres, para la cabecera. Un tutor sin nombre sale
 * por su rol ("Mamá") y "no hay" no sale: la cabecera cuenta quién está, no
 * quién falta.
 */
export function guardianNames(guardians: Guardian[]): string {
  return guardians
    .filter((g) => g.role !== 'NINGUNO')
    .map((g) => g.name.trim() || GUARDIAN_ROLE_LABELS[g.role])
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
  if (
    t.year < b.year ||
    (t.year === b.year && (t.month < b.month || (t.month === b.month && t.day < b.day)))
  ) {
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

export interface PriorityDescription {
  level: PriorityLevel;
  /** De dónde sale: la edad, la marca manual, las dos, o nada. */
  source: 'AGE' | 'MANUAL' | 'BOTH' | null;
  /** "por edad (hasta 24 meses)", "marcado a mano: bronquiolitis de repetición". */
  reason: string | null;
}

/**
 * La prioridad explicada, para que la cabecera y la tarjeta de marcas digan
 * lo mismo: un niño de 20 meses es prioritario POR EDAD aunque nadie haya
 * marcado la casilla, y eso hay que decirlo, no dejar que parezca un error.
 */
export function describePriority(
  input: { ageMonths: number | null; priorityFlag: boolean; priorityReason?: string | null },
  policy: BookingPolicy,
): PriorityDescription {
  const level = priorityLevel(input, policy);
  const rule = policy.priorityAgeMonths;
  const byAge =
    rule !== null &&
    input.ageMonths !== null &&
    (input.ageMonths <= rule.veryHighMax || input.ageMonths <= rule.highMax);
  const byFlag = input.priorityFlag;
  const source = byAge && byFlag ? 'BOTH' : byAge ? 'AGE' : byFlag ? 'MANUAL' : null;
  const parts: string[] = [];
  if (byAge && rule) {
    const cap = input.ageMonths !== null && input.ageMonths <= rule.veryHighMax ? rule.veryHighMax : rule.highMax;
    parts.push(`por edad (hasta ${cap} meses)`);
  }
  if (byFlag) {
    const reason = input.priorityReason?.trim();
    parts.push(reason ? `marcado a mano: ${reason}` : 'marcado a mano');
  }
  return { level, source, reason: parts.length ? parts.join(' · ') : null };
}

// ─── Primeras visitas ────────────────────────────────────────────────────────

/**
 * Lo que el motor de huecos necesita saber de las primeras visitas. Es un
 * recorte de la política: null cuando la clínica no tiene ninguna regla, para
 * que el motor no haga trabajo de más.
 */
export interface FirstVisitRules {
  maxConsecutive: number | null;
  blackouts: FirstVisitBlackout[];
}

export function firstVisitRules(policy: BookingPolicy): FirstVisitRules | null {
  if (policy.maxConsecutiveFirstVisits === null && policy.firstVisitBlackouts.length === 0) {
    return null;
  }
  return {
    maxConsecutive: policy.maxConsecutiveFirstVisits,
    blackouts: policy.firstVisitBlackouts,
  };
}

/** ¿Cae este minuto local de este día en una franja sin primeras visitas? */
export function isFirstVisitBlackout(
  weekday: number,
  startMinute: number,
  rules: Pick<BookingPolicy, 'firstVisitBlackouts'> | Pick<FirstVisitRules, 'blackouts'>,
): boolean {
  const blackouts = 'blackouts' in rules ? rules.blackouts : rules.firstVisitBlackouts;
  return blackouts.some(
    (b) => b.weekday === weekday && startMinute >= b.fromMinute && startMinute < b.toMinute,
  );
}

export const PRIORITY_RANK: Record<PriorityLevel, number> = {
  VERY_HIGH: 2,
  HIGH: 1,
  NORMAL: 0,
};

/**
 * Ordena de más a menos prioritario conservando, a igualdad, el orden en que
 * llegaron (que en la lista de espera es la antigüedad). Es estable a
 * propósito: la prioridad reordena, no baraja.
 */
export function sortByPriority<T>(items: T[], levelOf: (item: T) => PriorityLevel): T[] {
  return items
    .map((item, index) => ({ item, index, rank: PRIORITY_RANK[levelOf(item)] }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((x) => x.item);
}

// ─── Cumpleaños ──────────────────────────────────────────────────────────────

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * ¿Cumple años hoy? Quien nació un 29 de febrero lo celebra el 28 los años
 * que no son bisiestos: sin esto, tres de cada cuatro años no habría aviso.
 */
export function isBirthdayOn(birthDate: string, todayKey: string): boolean {
  const b = parseDateKey(birthDate);
  const t = parseDateKey(todayKey);
  if (!b || !t) return false;
  if (t.year < b.year) return false;
  if (b.month === t.month && b.day === t.day) return true;
  return b.month === 2 && b.day === 29 && t.month === 2 && t.day === 28 && !isLeapYear(t.year);
}

// ─── Lo que se le cuenta a los asistentes ────────────────────────────────────

/**
 * La sección del prompt que hace que un asistente atienda como esta clínica.
 * Es la misma para WhatsApp y para voz (Retell la recibe como variable): los
 * nombres de las tools coinciden en los dos canales.
 *
 * Lo que aquí se dice, el servidor lo impone además por su cuenta (edad,
 * aviso médico, patient_id obligatorio): esto es para que el asistente lo haga
 * bien a la primera, no la única barrera.
 */
export function buildCareProtocolSection(profile: CareProfile): string {
  const policy = profile.bookingPolicy;
  const range = describeAgeRange(policy);
  const lines: string[] = [
    '# Cómo atiende esta clínica (perfil pediátrico)',
    'El PACIENTE es el niño o la niña; quien escribe o llama es su madre, su padre o un tutor. Cada niño tiene su propia ficha aunque varios hermanos compartan el teléfono, así que nunca des por hecho quién es el paciente: pregúntalo.',
  ];
  if (range) {
    lines.push(
      `Sólo se atiende a bebés y niños ${range} (incluidos). Si el niño es mayor, explícalo con amabilidad y no des cita.`,
    );
  }
  lines.push(
    '',
    'Herramientas en esta clínica:',
    '- get_patient_info(phone) devuelve los niños registrados con ese teléfono, con su edad y su patient_id. Si no devuelve ninguno, es una PRIMERA VISITA.',
    '- register_patient da de alta al NIÑO: first_name y last_name son los del niño, birth_date (YYYY-MM-DD) es obligatoria y guardian_name es el nombre del titular del teléfono. Si el tutor cuenta una enfermedad importante, un ingreso reciente, TDAH, autismo o algo parecido, pásalo en medical_alert: la ficha queda marcada, NO se da cita y se pasa la conversación a una persona del equipo.',
    '- check_availability: en una primera visita pasa first_visit=true. La clínica reserva las primeras visitas en horarios concretos: ofrece sólo lo que devuelva.',
    '- book_appointment: pasa SIEMPRE patient_id (el que devolvió get_patient_info o register_patient). Sin patient_id no se reserva.',
  );
  if (policy.siblingsConsecutive) {
    lines.push(
      '- Gemelos o hermanos que vienen juntos: cada niño con su patient_id y en huecos seguidos. Reserva el primero y vuelve a check_availability para el siguiente, salvo que prefieran horarios distintos o cita para uno solo.',
    );
  }
  if (policy.priorityAgeMonths) {
    const { veryHighMax, highMax } = policy.priorityAgeMonths;
    lines.push(
      `- Prioridad: los bebés de hasta ${veryHighMax} meses son MUY prioritarios y hasta ${highMax} meses prioritarios; también quien esté marcado como prioritario en su ficha (get_patient_info lo dice y por qué). A un paciente prioritario ofrécele el primer hueco disponible y, si no hay nada cercano, pásalo a recepción para que le hagan sitio.`,
    );
  }
  if (profile.firstVisitProtocol) {
    lines.push(
      '',
      '# Protocolo de primera visita (palabras de la clínica)',
      profile.firstVisitProtocol,
    );
  }
  return lines.join('\n');
}
