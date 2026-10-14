import 'server-only';
import { type AnyColumn, type SQL, and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  normalizePatientPhone,
  patientIdFromKey,
  patientKeyForPerson,
  phoneDigits,
  samePhone,
} from '@/lib/agenda/patients';
import {
  type AnamnesisAnswers,
  type Guardian,
  anamnesisAnswersSchema,
  guardiansSchema,
  parseAnamnesisAnswers,
  parseGuardians,
  primaryGuardian,
} from '@/lib/care-profile/policy';
import { MAX_PRIOR_RED_FLAGS } from '@/lib/care-profile/signals';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicalNotes,
  invoices,
  patientCharges,
  patientConsents,
  patients,
  users,
  whatsappContacts,
} from '@/lib/db/schema';
import { titleCaseName } from '@/lib/patients/names';
import { samePhoneSql, upsertPatientRecord } from '@/lib/patients/registry';
import {
  FOLD_FROM,
  FOLD_TO,
  escapeLike,
  foldSearchText,
  phoneDigitsQuery,
} from '@/lib/patients/search-text';

/**
 * El paciente como PERSONA, separado del contacto que llama.
 *
 * La libreta (`lib/patients/registry.ts`) es única por teléfono y para casi
 * todas las clínicas eso es el paciente. En una clínica pediátrica no: el
 * móvil es de la madre o del padre y detrás hay hermanos —gemelos, incluso,
 * que se agendan en horas seguidas—. Aquí vive el niño: nombre, fecha de
 * nacimiento, quiénes son mamá y papá, la anamnesis y las marcas de la ficha.
 * Cuelga del contacto (`contactId`) y su identidad en la agenda es `pat:<id>`.
 *
 * Sólo lo usan las clínicas con perfil de atención (`tenant_care_profile`);
 * para el resto la tabla queda vacía y nada cambia.
 */

export class PatientValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatientValidationError';
  }
}

/** Ya hay una ficha para ese niño: se usa esa, no se abre otra. */
export class DuplicatePatientError extends PatientValidationError {
  constructor(readonly existing: PatientPerson) {
    super(
      `${existing.fullName} ya tiene ficha${existing.contactPhone ? ` (${existing.contactPhone})` : ''}. Ábrela desde Pacientes en vez de crear otra: así su historia sigue en un solo sitio.`,
    );
    this.name = 'DuplicatePatientError';
  }
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de nacimiento inválida.');

export const patientInputSchema = z.object({
  firstName: z.string().trim().min(1, 'El nombre es obligatorio.').max(80),
  lastName: z.string().trim().max(120).optional().or(z.literal('')),
  birthDate: dateKey.nullable().optional().or(z.literal('')),
  guardians: guardiansSchema.optional(),
  /** Teléfono del tutor. Crea o enlaza su ficha de contacto. */
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  /** Nombre del titular del teléfono, si se sabe. */
  contactName: z.string().trim().max(160).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  /**
   * Respuestas de anamnesis que se guardan junto con los datos: las alertas
   * clínicas del diálogo de edición. Se fusionan con lo que ya había.
   */
  anamnesisPatch: anamnesisAnswersSchema.optional(),
});
export type PatientInput = z.infer<typeof patientInputSchema>;

export const patientMarksSchema = z.object({
  priorityFlag: z.boolean(),
  priorityReason: z.string().trim().max(300).optional().or(z.literal('')),
  googleReview: z.boolean(),
  /** Si no se manda, el aviso médico se deja como estaba. */
  needsHumanReview: z.boolean().optional(),
  reviewReason: z.string().trim().max(500).optional().or(z.literal('')),
  /** Familia que duda. Si no se manda, se deja como estaba. */
  hesitant: z.boolean().optional(),
  hesitantNote: z.string().trim().max(300).optional().or(z.literal('')),
  /** Banderas rojas de antes de la plataforma. Si no se manda, se deja como estaba. */
  priorRedFlags: z.number().int().min(0).max(MAX_PRIOR_RED_FLAGS).optional(),
});
export type PatientMarksInput = z.infer<typeof patientMarksSchema>;

export type PatientRow = typeof patients.$inferSelect;

export interface PatientPerson {
  id: string;
  tenantId: string;
  contactId: string | null;
  firstName: string;
  lastName: string | null;
  fullName: string;
  /** 'YYYY-MM-DD' o null. */
  birthDate: string | null;
  guardians: Guardian[];
  anamnesis: AnamnesisAnswers;
  priorityFlag: boolean;
  priorityReason: string | null;
  googleReview: boolean;
  /** Aviso médico pendiente de que lo valore una persona. Los agentes no reservan. */
  needsHumanReview: boolean;
  reviewReason: string | null;
  /** Familia que duda: pregunta, no coge cita y al tiempo la coge. */
  hesitant: boolean;
  hesitantNote: string | null;
  /** Banderas rojas de antes de la plataforma; las nuevas salen de la agenda. */
  priorRedFlags: number;
  notes: string | null;
  /** Quién contestó la anamnesis por última vez y cuándo. */
  anamnesisUpdatedAt: Date | null;
  anamnesisUpdatedByEmail: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  contactPhone: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

export interface PatientScope {
  tenantId: string;
  userId: string | null;
}

// El alias de `users` (quién guardó la anamnesis) se crea al usarlo, no al
// importar: hay tests que sustituyen el esquema por un mock parcial y un
// `alias()` a nivel de módulo reventaba al cargar este archivo.
function anamnesisUserAlias() {
  return alias(users, 'anamnesis_user');
}

function selectWith(anamnesisUser: ReturnType<typeof anamnesisUserAlias>) {
  return {
    patient: patients,
    contactPhone: whatsappContacts.phoneE164,
    contactName: whatsappContacts.name,
    contactEmail: whatsappContacts.email,
    anamnesisUpdatedByEmail: anamnesisUser.email,
  };
}

export function patientFullName(p: { firstName: string; lastName: string | null }): string {
  return [p.firstName, p.lastName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ');
}

function toPerson(row: {
  patient: PatientRow;
  contactPhone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  anamnesisUpdatedByEmail: string | null;
}): PatientPerson {
  const p = row.patient;
  return {
    id: p.id,
    tenantId: p.tenantId,
    contactId: p.contactId,
    firstName: p.firstName,
    lastName: p.lastName,
    fullName: patientFullName(p),
    birthDate: p.birthDate,
    guardians: parseGuardians(p.guardians),
    anamnesis: parseAnamnesisAnswers(p.anamnesis),
    priorityFlag: p.priorityFlag,
    priorityReason: p.priorityReason,
    googleReview: p.googleReview,
    needsHumanReview: p.needsHumanReview,
    reviewReason: p.reviewReason,
    hesitant: p.hesitant,
    hesitantNote: p.hesitantNote,
    priorRedFlags: p.priorRedFlags,
    notes: p.notes,
    anamnesisUpdatedAt: p.anamnesisUpdatedAt,
    anamnesisUpdatedByEmail: row.anamnesisUpdatedByEmail,
    active: p.active,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    contactPhone: row.contactPhone,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getPatientPerson(
  tenantId: string,
  patientId: string,
): Promise<PatientPerson | null> {
  const anamnesisUser = anamnesisUserAlias();
  const rows = await db
    .select(selectWith(anamnesisUser))
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .leftJoin(anamnesisUser, eq(anamnesisUser.id, patients.anamnesisUpdatedByUserId))
    .where(and(eq(patients.tenantId, tenantId), eq(patients.id, patientId)))
    .limit(1);
  const row = rows[0];
  return row ? toPerson(row) : null;
}

export async function getPatientPersons(
  tenantId: string,
  patientIds: string[],
): Promise<Map<string, PatientPerson>> {
  const ids = [...new Set(patientIds.filter(Boolean))];
  const out = new Map<string, PatientPerson>();
  if (ids.length === 0) return out;
  const anamnesisUser = anamnesisUserAlias();
  const rows = await db
    .select(selectWith(anamnesisUser))
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .leftJoin(anamnesisUser, eq(anamnesisUser.id, patients.anamnesisUpdatedByUserId))
    .where(and(eq(patients.tenantId, tenantId), inArray(patients.id, ids)));
  for (const row of rows) out.set(row.patient.id, toPerson(row));
  return out;
}

export async function listPatientPersons(
  tenantId: string,
  opts: { search?: string; limit?: number; includeInactive?: boolean } = {},
): Promise<PatientPerson[]> {
  const where = [eq(patients.tenantId, tenantId)];
  if (!opts.includeInactive) where.push(eq(patients.active, true));
  const filter = opts.search ? patientSearchFilter(opts.search) : null;
  if (filter) where.push(filter);
  const anamnesisUser = anamnesisUserAlias();
  const rows = await db
    .select(selectWith(anamnesisUser))
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .leftJoin(anamnesisUser, eq(anamnesisUser.id, patients.anamnesisUpdatedByUserId))
    .where(and(...where))
    .orderBy(asc(patients.lastName), asc(patients.firstName))
    .limit(opts.limit ?? 300);
  return rows.map(toPerson);
}

/**
 * Filtro de búsqueda de pacientes: sin tildes ni mayúsculas, por nombre,
 * apellidos, tutores y titular del teléfono, o por teléfono si lo tecleado son
 * dígitos. Cada palabra tiene que aparecer, en cualquier orden: "santalla
 * julieta" encuentra a Julieta Santalla Cruz. Exige el join a
 * `whatsapp_contacts` en la query que lo use.
 */
export function patientSearchFilter(search: string): SQL | undefined {
  const digits = phoneDigitsQuery(search);
  if (digits) {
    const like = `%${digits}%`;
    return or(
      sql`regexp_replace(coalesce(${whatsappContacts.phoneE164}, ''), '[^0-9]', '', 'g') like ${like}`,
      sql`regexp_replace(coalesce(jsonb_path_query_array(${patients.guardians}, '$[*].phone')::text, ''), '[^0-9]', '', 'g') like ${like}`,
    );
  }
  const words = foldSearchText(search).split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return undefined;
  const haystack = sql`translate(lower(${patients.firstName} || ' ' || coalesce(${patients.lastName}, '') || ' ' || coalesce(jsonb_path_query_array(${patients.guardians}, '$[*].name')::text, '') || ' ' || coalesce(${whatsappContacts.name}, '')), ${FOLD_FROM}, ${FOLD_TO})`;
  return and(...words.map((w) => sql`${haystack} like ${`%${escapeLike(w)}%`}`));
}

/** Los pacientes que cuelgan de un teléfono: los hijos del tutor que llama. */
export async function listPatientsForPhone(
  tenantId: string,
  phone: string | null | undefined,
): Promise<PatientPerson[]> {
  const phoneE164 = normalizePatientPhone(phone);
  if (!phoneE164) return [];
  const digits = phoneDigits(phoneE164);
  const anamnesisUser = anamnesisUserAlias();
  // El teléfono puede ser el del titular (el contacto de la ficha) o el de
  // cualquier otro tutor: cuando escribe el padre desde su móvil, sus hijos
  // son los mismos que ya tienen historia, no unos nuevos.
  const rows = await db
    .select(selectWith(anamnesisUser))
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .leftJoin(anamnesisUser, eq(anamnesisUser.id, patients.anamnesisUpdatedByUserId))
    .where(
      and(
        eq(patients.tenantId, tenantId),
        eq(patients.active, true),
        or(
          samePhoneSql(whatsappContacts.phoneE164, digits),
          sql`exists (select 1 from jsonb_array_elements(case when jsonb_typeof(${patients.guardians}) = 'array' then ${patients.guardians} else '[]'::jsonb end) g where ${samePhoneSql(sql`g->>'phone'`, digits)})`,
        ),
      ),
    )
    .orderBy(asc(patients.createdAt));
  return rows.map(toPerson);
}

/**
 * Enlaza (o crea) la ficha de contacto del tutor. Devuelve su id, o null si no
 * se dio teléfono. Un teléfono que no se puede normalizar es un error, no un
 * "sin contacto": el tutor es a quien se le manda el recordatorio.
 */
async function resolveContactId(
  tenantId: string,
  phone: string | null | undefined,
  name: string | null | undefined,
): Promise<string | null> {
  const raw = phone?.trim();
  if (!raw) return null;
  if (!normalizePatientPhone(raw)) {
    throw new PatientValidationError(
      'El teléfono del tutor no es válido. Usa el formato +34 600 000 000.',
    );
  }
  const record = await upsertPatientRecord({ tenantId, phone: raw, fullName: name ?? null });
  return record?.id ?? null;
}

/**
 * Los tutores como se guardan: nombres en mayúscula inicial, como mucho un
 * titular del teléfono (el primero marcado; si nadie lo está y hay uno solo
 * con teléfono, es él).
 */
function normalizeGuardians(list: Guardian[] | undefined): Guardian[] {
  if (!list) return [];
  let primarySeen = false;
  const out = list.map((g) => {
    const primary = Boolean(g.primary) && !primarySeen && g.role !== 'NINGUNO';
    if (primary) primarySeen = true;
    return {
      role: g.role,
      name: titleCaseName(g.name),
      phone: emptyToNull(g.phone) ?? undefined,
      email: emptyToNull(g.email)?.toLowerCase() ?? undefined,
      channel: g.channel ?? null,
      primary,
    };
  });
  if (!primarySeen) {
    const withPhone = out.filter((g) => g.role !== 'NINGUNO' && g.phone);
    if (withPhone.length === 1 && withPhone[0]) withPhone[0].primary = true;
  }
  return out;
}

/**
 * El teléfono y el nombre del contacto de la ficha salen del titular marcado
 * entre los tutores; si nadie lo está, de lo que llegue suelto (es lo que
 * mandan los asistentes, que no saben de tutores).
 */
function contactFromInput(input: PatientInput, guardians: Guardian[]) {
  const primary = primaryGuardian(guardians);
  return {
    phone: primary?.phone?.trim() || input.contactPhone,
    name: primary?.name.trim() || titleCaseName(input.contactName),
  };
}

function checkBirthDate(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v > todayKeyUtc()) {
    throw new PatientValidationError('La fecha de nacimiento no puede ser futura.');
  }
  return v;
}

/** Sin tildes, sin mayúsculas ni espacios de más: "José  Pérez" = "jose perez". */
function nameForMatch(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La ficha que ya existe para ese niño, si la hay. Mismo nombre completo y,
 * además, misma fecha de nacimiento o (si a alguna le falta) el mismo
 * teléfono de un tutor. Dos hermanos nunca se llaman igual; dos fichas con el
 * mismo nombre y el mismo móvil son la misma persona dada de alta dos veces,
 * y la IA acabaría agendando en la que no tiene la historia.
 */
export async function findDuplicatePatient(
  tenantId: string,
  input: {
    firstName: string;
    lastName?: string | null;
    birthDate?: string | null;
    phones: string[];
  },
): Promise<PatientPerson | null> {
  const wanted = nameForMatch(`${input.firstName} ${input.lastName ?? ''}`);
  if (!wanted) return null;
  const rows = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      birthDate: patients.birthDate,
      guardians: patients.guardians,
      phone: whatsappContacts.phoneE164,
    })
    .from(patients)
    .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
    .where(and(eq(patients.tenantId, tenantId), eq(patients.active, true)));
  const phones = input.phones.filter(Boolean);
  const match = rows.find((r) => {
    if (nameForMatch(`${r.firstName} ${r.lastName ?? ''}`) !== wanted) return false;
    if (input.birthDate && r.birthDate) return input.birthDate === r.birthDate;
    const theirs = [r.phone, ...guardianPhones(r.guardians)];
    return (
      phones.length === 0 ||
      theirs.every((p) => !p) ||
      phones.some((p) => theirs.some((t) => samePhone(p, t)))
    );
  });
  return match ? getPatientPerson(tenantId, match.id) : null;
}

function guardianPhones(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (g && typeof g === 'object' ? (g as { phone?: unknown }).phone : null))
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
}

export async function createPatient(
  scope: PatientScope,
  raw: PatientInput,
): Promise<PatientPerson> {
  const input = patientInputSchema.parse(raw);
  const birthDate = checkBirthDate(input.birthDate);
  const guardians = normalizeGuardians(input.guardians);
  const contact = contactFromInput(input, guardians);
  const duplicate = await findDuplicatePatient(scope.tenantId, {
    firstName: input.firstName,
    lastName: input.lastName,
    birthDate,
    phones: [contact.phone ?? '', ...guardians.map((g) => g.phone ?? '')],
  });
  if (duplicate) throw new DuplicatePatientError(duplicate);
  const contactId = await resolveContactId(scope.tenantId, contact.phone, contact.name);

  const [row] = await db
    .insert(patients)
    .values({
      tenantId: scope.tenantId,
      contactId,
      firstName: titleCaseName(input.firstName),
      lastName: emptyToNull(titleCaseName(input.lastName)),
      birthDate,
      guardians,
      anamnesis: input.anamnesisPatch ?? {},
      ...(input.anamnesisPatch && Object.keys(input.anamnesisPatch).length > 0
        ? { anamnesisUpdatedAt: new Date(), anamnesisUpdatedByUserId: scope.userId }
        : {}),
      notes: emptyToNull(input.notes),
      createdByUserId: scope.userId,
    })
    .returning({ id: patients.id });
  if (!row) throw new PatientValidationError('No se pudo guardar el paciente.');

  const person = await getPatientPerson(scope.tenantId, row.id);
  if (!person) throw new PatientValidationError('No se pudo guardar el paciente.');
  return person;
}

export async function updatePatient(
  scope: PatientScope,
  patientId: string,
  raw: PatientInput,
): Promise<PatientPerson> {
  const input = patientInputSchema.parse(raw);
  const birthDate = checkBirthDate(input.birthDate);

  const current = await getPatientPerson(scope.tenantId, patientId);
  if (!current) throw new PatientValidationError('Ese paciente no existe en esta clínica.');

  const guardians = input.guardians ? normalizeGuardians(input.guardians) : current.guardians;
  const contact = contactFromInput(input, guardians);
  // Sin teléfono en el formulario se conserva el contacto que había: vaciar el
  // campo no es "desvincular", es "no lo cambio".
  const contactId =
    (await resolveContactId(scope.tenantId, contact.phone, contact.name)) ?? current.contactId;

  const patch = input.anamnesisPatch;
  const anamnesisChanged = Boolean(patch && Object.keys(patch).length > 0);

  await db
    .update(patients)
    .set({
      contactId,
      firstName: titleCaseName(input.firstName),
      lastName: emptyToNull(titleCaseName(input.lastName)),
      birthDate,
      guardians,
      notes: emptyToNull(input.notes),
      ...(anamnesisChanged && patch
        ? {
            anamnesis: { ...current.anamnesis, ...patch },
            anamnesisUpdatedAt: new Date(),
            anamnesisUpdatedByUserId: scope.userId,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, patientId)));

  const person = await getPatientPerson(scope.tenantId, patientId);
  if (!person) throw new PatientValidationError('Ese paciente no existe en esta clínica.');
  return person;
}

/** La anamnesis entera: se guarda como llega, validada. */
export async function saveAnamnesis(
  scope: PatientScope,
  patientId: string,
  raw: unknown,
): Promise<AnamnesisAnswers> {
  const parsed = anamnesisAnswersSchema.safeParse(raw ?? {});
  if (!parsed.success)
    throw new PatientValidationError('La anamnesis no tiene el formato esperado.');

  const [row] = await db
    .update(patients)
    .set({
      anamnesis: parsed.data,
      anamnesisUpdatedAt: new Date(),
      anamnesisUpdatedByUserId: scope.userId,
      updatedAt: new Date(),
    })
    .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, patientId)))
    .returning({ id: patients.id });
  if (!row) throw new PatientValidationError('Ese paciente no existe en esta clínica.');
  return parsed.data;
}

/** Prioritario (con motivo), reseña en Google, duda y banderas previas. */
export async function setPatientMarks(
  scope: PatientScope,
  patientId: string,
  raw: PatientMarksInput,
): Promise<void> {
  const input = patientMarksSchema.parse(raw);
  const [row] = await db
    .update(patients)
    .set({
      priorityFlag: input.priorityFlag,
      priorityReason: input.priorityFlag ? emptyToNull(input.priorityReason) : null,
      googleReview: input.googleReview,
      ...(input.needsHumanReview === undefined
        ? {}
        : {
            needsHumanReview: input.needsHumanReview,
            reviewReason: input.needsHumanReview ? emptyToNull(input.reviewReason) : null,
          }),
      ...(input.hesitant === undefined
        ? {}
        : {
            hesitant: input.hesitant,
            hesitantNote: input.hesitant ? emptyToNull(input.hesitantNote) : null,
          }),
      ...(input.priorRedFlags === undefined ? {} : { priorRedFlags: input.priorRedFlags }),
      updatedAt: new Date(),
    })
    .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, patientId)))
    .returning({ id: patients.id });
  if (!row) throw new PatientValidationError('Ese paciente no existe en esta clínica.');
}

/**
 * Aviso médico que deja un asistente: el tutor contó algo (enfermedad
 * importante, ingreso reciente, TDAH, autismo…) que la clínica quiere valorar
 * en persona. Mientras esté puesto, los agentes no le dan cita.
 */
export async function setPatientReview(
  scope: PatientScope,
  patientId: string,
  input: { needsHumanReview: boolean; reviewReason: string | null },
): Promise<void> {
  const [row] = await db
    .update(patients)
    .set({
      needsHumanReview: input.needsHumanReview,
      reviewReason: input.needsHumanReview ? emptyToNull(input.reviewReason) : null,
      updatedAt: new Date(),
    })
    .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, patientId)))
    .returning({ id: patients.id });
  if (!row) throw new PatientValidationError('Ese paciente no existe en esta clínica.');
}

// ─── Quitar a un paciente ────────────────────────────────────────────────────

export interface PatientDeletionPreview {
  fullName: string;
  appointments: number;
  notes: number;
  /** Consentimientos ya firmados: son historia y no se borran. */
  signedConsents: number;
  canDelete: boolean;
}

/**
 * Qué arrastraría borrar a este paciente. Sólo se borra sin rastro cuando no
 * hay nada: un alta de prueba o un error. Con citas, notas o un consentimiento
 * firmado, no: eso es historia clínica y es de la clínica y del paciente.
 */
export async function previewPatientDeletion(
  tenantId: string,
  patientId: string,
): Promise<PatientDeletionPreview | null> {
  const person = await getPatientPerson(tenantId, patientId);
  if (!person) return null;
  const key = patientKeyForPerson(patientId);

  const [[appts], [notes], [consents]] = await Promise.all([
    db
      .select({ n: count() })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          or(eq(agendaAppointments.patientId, patientId), eq(agendaAppointments.patientKey, key)),
        ),
      ),
    db
      .select({ n: count() })
      .from(clinicalNotes)
      .where(
        and(
          eq(clinicalNotes.tenantId, tenantId),
          or(eq(clinicalNotes.patientId, patientId), eq(clinicalNotes.patientKey, key)),
        ),
      ),
    db
      .select({ n: count() })
      .from(patientConsents)
      .where(
        and(
          eq(patientConsents.tenantId, tenantId),
          eq(patientConsents.patientId, patientId),
          eq(patientConsents.status, 'SIGNED'),
        ),
      ),
  ]);

  const appointments = Number(appts?.n ?? 0);
  const noteCount = Number(notes?.n ?? 0);
  const signedConsents = Number(consents?.n ?? 0);
  return {
    fullName: person.fullName,
    appointments,
    notes: noteCount,
    signedConsents,
    canDelete: appointments === 0 && noteCount === 0 && signedConsents === 0,
  };
}

/** Borra sin rastro a un paciente que no tiene historia. Si la tiene, se rechaza. */
export async function deletePatient(scope: PatientScope, patientId: string): Promise<void> {
  const preview = await previewPatientDeletion(scope.tenantId, patientId);
  if (!preview) throw new PatientValidationError('Ese paciente no existe en esta clínica.');
  if (!preview.canDelete) {
    throw new PatientValidationError(
      'Este paciente tiene historia (citas, notas o un consentimiento firmado) y no se puede borrar.',
    );
  }
  await db
    .delete(patients)
    .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, patientId)));
}

// ─── Fichas duplicadas ───────────────────────────────────────────────────────

/**
 * Junta en UNA ficha lo que estaba repartido entre duplicados: el mismo niño
 * dado de alta dos o tres veces (a mano, importado, por el asistente) o citas
 * que quedaron colgando del teléfono del tutor en vez de del niño.
 *
 * `dropKeys` son claves de paciente: `pat:<id>` de otras fichas (que se borran
 * después de mover todo) o `tel:`/`ghl:`/`email:`/`anon:` de citas sueltas
 * (el contacto no se toca: es el tutor). Citas, notas, cobros, facturas y
 * consentimientos pasan a la ficha que se queda; de los datos del niño, la que
 * se queda manda y sólo se rellenan sus huecos. Todo en una transacción.
 */
export async function mergePatients(
  scope: PatientScope,
  keepId: string,
  dropKeys: string[],
): Promise<{ moved: number }> {
  const keepKey = patientKeyForPerson(keepId);
  const keys = [...new Set(dropKeys.map((k) => k.trim()))].filter((k) => k && k !== keepKey);
  if (keys.length === 0) throw new PatientValidationError('Elige al menos una ficha para unir.');

  return db.transaction(async (tx) => {
    const [keep] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, keepId)))
      .limit(1)
      .for('update');
    if (!keep) throw new PatientValidationError('La ficha que se queda ya no existe.');
    const keepName = patientFullName(keep);

    let moved = 0;
    for (const key of keys) {
      const dropId = patientIdFromKey(key);
      const drop = dropId
        ? (
            await tx
              .select()
              .from(patients)
              .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, dropId)))
              .limit(1)
          )[0]
        : null;
      if (dropId && !drop) continue;

      const owned = (table: { tenantId: AnyColumn; patientKey: AnyColumn; patientId: AnyColumn }) =>
        and(
          eq(table.tenantId, scope.tenantId),
          dropId
            ? or(eq(table.patientKey, key), eq(table.patientId, dropId))
            : eq(table.patientKey, key),
        );
      const appts = await tx
        .update(agendaAppointments)
        .set({ patientKey: keepKey, patientId: keepId, patientName: keepName })
        .where(owned(agendaAppointments))
        .returning({ id: agendaAppointments.id });
      const notes = await tx
        .update(clinicalNotes)
        .set({ patientKey: keepKey, patientId: keepId, patientName: keepName })
        .where(owned(clinicalNotes))
        .returning({ id: clinicalNotes.id });
      await tx
        .update(patientCharges)
        .set({ patientKey: keepKey, patientId: keepId })
        .where(owned(patientCharges));
      await tx
        .update(invoices)
        .set({ patientKey: keepKey, patientId: keepId })
        .where(owned(invoices));
      moved += appts.length + notes.length;

      if (!drop) continue;
      await tx
        .update(patientConsents)
        .set({ patientId: keepId })
        .where(
          and(eq(patientConsents.tenantId, scope.tenantId), eq(patientConsents.patientId, drop.id)),
        );

      const keepGuardians = parseGuardians(keep.guardians);
      const dropGuardians = parseGuardians(drop.guardians).filter(
        (g) =>
          !keepGuardians.some(
            (k) =>
              (g.phone && k.phone && samePhone(g.phone, k.phone)) ||
              nameForMatch(g.name) === nameForMatch(k.name),
          ),
      );
      // Lo contestado en la que se queda manda; la otra sólo rellena lo que falte.
      const keepAnamnesis = keep.anamnesis ?? {};
      const dropAnamnesis = drop.anamnesis ?? {};
      const merged = {
        contactId: keep.contactId ?? drop.contactId,
        lastName: keep.lastName ?? drop.lastName,
        birthDate: keep.birthDate ?? drop.birthDate,
        guardians: [
          ...keepGuardians,
          ...dropGuardians.map((g) => ({ ...g, primary: false })),
        ].slice(0, 4),
        anamnesis: { ...dropAnamnesis, ...keepAnamnesis },
        priorityFlag: keep.priorityFlag || drop.priorityFlag,
        priorityReason: keep.priorityReason ?? drop.priorityReason,
        googleReview: keep.googleReview || drop.googleReview,
        needsHumanReview: keep.needsHumanReview || drop.needsHumanReview,
        reviewReason: keep.reviewReason ?? drop.reviewReason,
        hesitant: keep.hesitant || drop.hesitant,
        hesitantNote: keep.hesitantNote ?? drop.hesitantNote,
        priorRedFlags: Math.max(keep.priorRedFlags, drop.priorRedFlags),
        notes:
          [keep.notes, drop.notes]
            .map((n) => n?.trim())
            .filter((n, i, all): n is string => Boolean(n) && all.indexOf(n) === i)
            .join('\n\n') || null,
      };
      Object.assign(keep, merged);
      await tx
        .update(patients)
        .set({ ...merged, updatedAt: new Date() })
        .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, keepId)));
      await tx
        .delete(patients)
        .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, drop.id)));
    }
    return { moved };
  });
}
