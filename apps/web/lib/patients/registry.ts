import 'server-only';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';

import { contactRefsFor, normalizePatientPhone } from '@/lib/agenda/patients';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  clinicalNotes,
  patients,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';

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

// ─── Quitar un contacto ──────────────────────────────────────────────────────

export interface ContactDeletionPreview {
  name: string | null;
  phone: string;
  appointments: number;
  notes: number;
  /** Niños que cuelgan de este contacto (es su tutor). */
  patients: number;
  /** Mensajes de WhatsApp que se irían con él. */
  messages: number;
  canDelete: boolean;
}

/**
 * Qué arrastraría borrar un contacto de la libreta. Existe para limpiar los
 * contactos que dejan las pruebas del asistente: se ejecutan con tools reales
 * sobre la clínica que se está gestionando y dan de alta a gente que no
 * existe. Con citas, notas o niños a su cargo no se borra: eso es historia.
 */
export async function previewContactDeletion(
  tenantId: string,
  contactId: string,
): Promise<ContactDeletionPreview | null> {
  const rows = await db
    .select({
      id: whatsappContacts.id,
      phone: whatsappContacts.phoneE164,
      name: whatsappContacts.name,
      email: whatsappContacts.email,
      ghlContactId: whatsappContacts.ghlContactId,
    })
    .from(whatsappContacts)
    .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.id, contactId)))
    .limit(1);
  const contact = rows[0];
  if (!contact) return null;

  const refs = contactRefsFor({
    ghlContactId: contact.ghlContactId,
    phone: contact.phone,
    email: contact.email,
  });
  const refsFilter = refs.length > 0 ? inArray(agendaAppointments.patientKey, refs) : sql`false`;
  const noteRefsFilter = refs.length > 0 ? inArray(clinicalNotes.patientKey, refs) : sql`false`;

  const [[appts], [notes], [kids], [messages]] = await Promise.all([
    db
      .select({ n: count() })
      .from(agendaAppointments)
      .where(
        and(
          eq(agendaAppointments.tenantId, tenantId),
          or(refsFilter, eq(agendaAppointments.patientPhone, contact.phone)),
        ),
      ),
    db
      .select({ n: count() })
      .from(clinicalNotes)
      .where(and(eq(clinicalNotes.tenantId, tenantId), noteRefsFilter)),
    db
      .select({ n: count() })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.contactId, contactId))),
    db
      .select({ n: count() })
      .from(whatsappMessages)
      .innerJoin(
        whatsappConversations,
        eq(whatsappConversations.id, whatsappMessages.conversationId),
      )
      .where(
        and(
          eq(whatsappConversations.tenantId, tenantId),
          eq(whatsappConversations.contactId, contactId),
        ),
      ),
  ]);

  const appointments = Number(appts?.n ?? 0);
  const noteCount = Number(notes?.n ?? 0);
  const kidCount = Number(kids?.n ?? 0);
  return {
    name: contact.name,
    phone: contact.phone,
    appointments,
    notes: noteCount,
    patients: kidCount,
    messages: Number(messages?.n ?? 0),
    canDelete: appointments === 0 && noteCount === 0 && kidCount === 0,
  };
}

/**
 * Borra un contacto sin historia. Sus conversaciones y mensajes se van con él
 * (cascada en la base); las citas y las notas lo impiden antes.
 */
export async function deleteContact(tenantId: string, contactId: string): Promise<void> {
  const preview = await previewContactDeletion(tenantId, contactId);
  if (!preview) throw new Error('Ese contacto no existe en esta clínica.');
  if (!preview.canDelete) {
    throw new Error(
      'Este contacto tiene citas, notas o pacientes a su cargo y no se puede borrar.',
    );
  }
  await db
    .delete(whatsappContacts)
    .where(and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.id, contactId)));
}
