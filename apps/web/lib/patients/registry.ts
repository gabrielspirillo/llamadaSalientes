import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';

import { normalizePatientPhone } from '@/lib/agenda/patients';
import { db } from '@/lib/db/client';
import { whatsappContacts } from '@/lib/db/schema';

/**
 * Fichero de pacientes de la plataforma.
 *
 * La clínica que no tiene CRM conectado también necesita saber a quién ha
 * atendido. Hasta aquí el único sitio donde se creaba un paciente era
 * GoHighLevel, así que sin CRM el agente no podía registrar a nadie y el
 * panel enseñaba la lista de pacientes vacía.
 *
 * La ficha vive en `whatsapp_contacts`, que pese al nombre es la libreta de
 * contactos de la plataforma: única por (tenant, teléfono), con nombre,
 * apellidos, correo y el id del CRM cuando lo hay, y con su propia pantalla de
 * detalle. Crear una segunda tabla de pacientes habría dejado dos libretas que
 * se separan al día siguiente: el mismo paciente escribiría por WhatsApp a una
 * y llamaría por teléfono a la otra.
 *
 * La identidad clínica (qué citas y qué notas son de quién) NO sale de aquí:
 * sale de la `patient_key` de la agenda (`lib/agenda/patients.ts`), que
 * funciona igual con CRM y sin él. Esta libreta es la ficha de contacto; la
 * clave es la identidad.
 */

export interface PatientRecord {
  id: string;
  phoneE164: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  ghlContactId: string | null;
}

const COLUMNS = {
  id: whatsappContacts.id,
  phoneE164: whatsappContacts.phoneE164,
  name: whatsappContacts.name,
  firstName: whatsappContacts.firstName,
  lastName: whatsappContacts.lastName,
  email: whatsappContacts.email,
  ghlContactId: whatsappContacts.ghlContactId,
};

/** "Marta Ruiz Gómez" → nombre "Marta", apellidos "Ruiz Gómez". */
export function splitFullName(raw: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  const [first, ...rest] = parts;
  return { firstName: first ?? null, lastName: rest.length > 0 ? rest.join(' ') : null };
}

export function joinName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  const full = [firstName, lastName]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ');
  return full || null;
}

/** Ficha por teléfono, o null si el teléfono no es utilizable o no existe. */
export async function findPatientByPhone(
  tenantId: string,
  phone: string | null | undefined,
): Promise<PatientRecord | null> {
  const phoneE164 = normalizePatientPhone(phone);
  if (!phoneE164) return null;

  const rows = await db
    .select(COLUMNS)
    .from(whatsappContacts)
    .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.phoneE164, phoneE164)))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertPatientInput {
  tenantId: string;
  phone: string | null | undefined;
  /** Nombre completo, si es lo único que se tiene. Se parte en nombre y apellidos. */
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  /** Id del CRM, cuando la clínica sí lo tiene conectado. */
  ghlContactId?: string | null;
}

/**
 * Crea o completa la ficha del paciente. Idempotente por (tenant, teléfono).
 *
 * Sólo RELLENA huecos: nunca pisa un dato que ya estaba con otro que llega
 * después. Lo que teclea recepción vale más que lo que entendió un agente por
 * teléfono, y el agente es quien más veces pasa por aquí.
 *
 * Devuelve null si no hay teléfono normalizable, porque la libreta se indexa
 * por teléfono. No es un error: la cita se guarda igual con el nombre, y la
 * `patient_key` de la agenda ya sabe caer al correo o al nombre.
 */
export async function upsertPatientRecord(
  input: UpsertPatientInput,
): Promise<PatientRecord | null> {
  const phoneE164 = normalizePatientPhone(input.phone);
  if (!phoneE164) return null;

  const fromFull = splitFullName(input.fullName);
  const firstName = input.firstName?.trim() || fromFull.firstName;
  const lastName = input.lastName?.trim() || fromFull.lastName;
  const name = joinName(firstName, lastName) ?? input.fullName?.trim() ?? null;
  const email = input.email?.trim() || null;
  const ghlContactId = input.ghlContactId?.trim() || null;

  const [row] = await db
    .insert(whatsappContacts)
    .values({ tenantId: input.tenantId, phoneE164, name, firstName, lastName, email, ghlContactId })
    .onConflictDoUpdate({
      target: [whatsappContacts.tenantId, whatsappContacts.phoneE164],
      set: {
        name: sql`coalesce(${whatsappContacts.name}, excluded.name)`,
        firstName: sql`coalesce(${whatsappContacts.firstName}, excluded.first_name)`,
        lastName: sql`coalesce(${whatsappContacts.lastName}, excluded.last_name)`,
        email: sql`coalesce(${whatsappContacts.email}, excluded.email)`,
        ghlContactId: sql`coalesce(${whatsappContacts.ghlContactId}, excluded.ghl_contact_id)`,
        updatedAt: new Date(),
      },
    })
    .returning(COLUMNS);

  return row ?? null;
}

/**
 * Guarda el correo del paciente en su ficha. A diferencia del upsert general,
 * este SÍ pisa el valor anterior: el paciente acaba de dictarlo, así que es
 * más reciente que lo que hubiera.
 */
export async function setPatientEmail(
  tenantId: string,
  phone: string | null | undefined,
  email: string,
): Promise<PatientRecord | null> {
  const phoneE164 = normalizePatientPhone(phone);
  const clean = email.trim();
  if (!phoneE164 || !clean) return null;

  const [row] = await db
    .insert(whatsappContacts)
    .values({ tenantId, phoneE164, email: clean })
    .onConflictDoUpdate({
      target: [whatsappContacts.tenantId, whatsappContacts.phoneE164],
      set: { email: clean, updatedAt: new Date() },
    })
    .returning(COLUMNS);

  return row ?? null;
}

/** Cómo se le nombra al paciente en una respuesta del agente. */
export function describePatient(record: PatientRecord): string {
  return joinName(record.firstName, record.lastName) ?? record.name ?? 'Sin nombre';
}

export interface ContactNameInfo {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

/**
 * Nombre y teléfono de varios pacientes a la vez, a partir de la identidad con
 * la que los guardan las tablas compartidas.
 *
 * Esa identidad puede ser el id del CRM o la `patient_key` de la agenda
 * (`tel:+34…`). Se mira, por ese orden, la réplica del CRM, la libreta de la
 * plataforma y, para lo que quede suelto, el propio teléfono de la clave.
 *
 * Existe porque la pantalla de la lista de espera resolvía los nombres sólo
 * contra `patients_cache`, que no la rellena nadie: la cola salía con todos los
 * pacientes sin nombre y sin teléfono.
 */
export async function resolveContactNames(
  tenantId: string,
  refs: string[],
): Promise<Map<string, ContactNameInfo>> {
  const out = new Map<string, ContactNameInfo>();
  const unique = [...new Set(refs.filter(Boolean))];
  if (unique.length === 0) return out;

  const { patientsCache } = await import('@/lib/db/schema');
  const { inArray } = await import('drizzle-orm');

  const crmRows = await db
    .select({
      ref: patientsCache.ghlContactId,
      firstName: patientsCache.firstName,
      lastName: patientsCache.lastName,
      phone: patientsCache.phone,
    })
    .from(patientsCache)
    .where(and(eq(patientsCache.tenantId, tenantId), inArray(patientsCache.ghlContactId, unique)));
  for (const r of crmRows) {
    out.set(r.ref, { firstName: r.firstName, lastName: r.lastName, phone: r.phone });
  }

  // Lo que falta: por id de CRM en la libreta, o por el teléfono de la clave.
  const pending = unique.filter((ref) => !out.has(ref));
  if (pending.length === 0) return out;

  const phoneOf = new Map<string, string>();
  for (const ref of pending) {
    const phone = ref.startsWith('tel:') ? ref.slice(4) : null;
    if (phone) phoneOf.set(ref, phone);
  }

  const phones = [...new Set(phoneOf.values())];
  const matchers = [
    phones.length > 0 ? inArray(whatsappContacts.phoneE164, phones) : null,
    inArray(whatsappContacts.ghlContactId, pending),
  ].filter((c) => c !== null);

  const bookRows = await db
    .select({
      phoneE164: whatsappContacts.phoneE164,
      ghlContactId: whatsappContacts.ghlContactId,
      name: whatsappContacts.name,
      firstName: whatsappContacts.firstName,
      lastName: whatsappContacts.lastName,
    })
    .from(whatsappContacts)
    .where(and(eq(whatsappContacts.tenantId, tenantId), or(...matchers)));

  for (const ref of pending) {
    const phone = phoneOf.get(ref) ?? null;
    const row = bookRows.find(
      (b) => (phone && b.phoneE164 === phone) || (b.ghlContactId && b.ghlContactId === ref),
    );
    if (row) {
      const split = splitFullName(row.name);
      out.set(ref, {
        firstName: row.firstName ?? split.firstName,
        lastName: row.lastName ?? split.lastName,
        phone: row.phoneE164,
      });
    } else if (phone) {
      out.set(ref, { firstName: null, lastName: null, phone });
    }
  }

  return out;
}
