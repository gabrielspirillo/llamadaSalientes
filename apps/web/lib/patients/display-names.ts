import 'server-only';

import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { patients, whatsappContacts } from '@/lib/db/schema';
import { patientFullName } from '@/lib/patients/persons';

export interface ContactDisplayName {
  /** Lo que se pinta como título: el nombre que tiene en la plataforma. */
  name: string;
  /** Nombre con el que escribe en WhatsApp, si es otro (p. ej. la madre). */
  whatsappName: string | null;
  /** Fichas de paciente (`patients.id`) que cuelgan de ese teléfono. */
  patientIds: string[];
}

/**
 * Nombre de plataforma de cada contacto del inbox. El que trae WhatsApp es el
 * que la persona se puso en su perfil ("Vanesa"), no el de la ficha: en una
 * clínica pediátrica quien escribe es la madre y el paciente es el niño.
 *
 * Orden: los pacientes que cuelgan de ese teléfono (como titular o como tutor)
 * → nombre y apellidos guardados en la libreta → nombre de WhatsApp. Una sola
 * consulta para toda la lista.
 */
export async function contactDisplayNames(
  tenantId: string,
  contactIds: string[],
): Promise<Map<string, ContactDisplayName>> {
  const out = new Map<string, ContactDisplayName>();
  const ids = [...new Set(contactIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const contacts = await db
    .select({
      id: whatsappContacts.id,
      phone: whatsappContacts.phoneE164,
      name: whatsappContacts.name,
      firstName: whatsappContacts.firstName,
      lastName: whatsappContacts.lastName,
    })
    .from(whatsappContacts)
    .where(and(eq(whatsappContacts.tenantId, tenantId), inArray(whatsappContacts.id, ids)));
  if (contacts.length === 0) return out;

  const phones = contacts.map((c) => c.phone);
  const people = await db
    .select({
      id: patients.id,
      contactId: patients.contactId,
      firstName: patients.firstName,
      lastName: patients.lastName,
      guardians: patients.guardians,
    })
    .from(patients)
    .where(
      and(
        eq(patients.tenantId, tenantId),
        or(
          inArray(patients.contactId, ids),
          sql`exists (select 1 from jsonb_array_elements(${patients.guardians}) g
                where g->>'phone' in ${phones})`,
        ),
      ),
    );

  const byContact = new Map<string, string[]>();
  const idsByContact = new Map<string, string[]>();
  const add = (contactId: string, name: string, patientId: string) => {
    const list = byContact.get(contactId) ?? [];
    if (!list.includes(name)) list.push(name);
    byContact.set(contactId, list);
    const pids = idsByContact.get(contactId) ?? [];
    if (!pids.includes(patientId)) pids.push(patientId);
    idsByContact.set(contactId, pids);
  };
  const idByPhone = new Map(contacts.map((c) => [c.phone, c.id]));
  for (const p of people) {
    const name = patientFullName(p);
    if (!name) continue;
    if (p.contactId && ids.includes(p.contactId)) add(p.contactId, name, p.id);
    for (const g of (p.guardians ?? []) as { phone?: string }[]) {
      const id = g.phone ? idByPhone.get(g.phone) : undefined;
      if (id) add(id, name, p.id);
    }
  }

  for (const c of contacts) {
    const waName = c.name?.trim() || null;
    const kids = byContact.get(c.id);
    const saved = [c.firstName, c.lastName]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(' ');
    const name = kids?.length
      ? kids.length === 1
        ? (kids[0] as string)
        : `${kids.slice(0, -1).join(', ')} y ${kids[kids.length - 1]}`
      : saved || waName || c.phone;
    out.set(c.id, {
      name,
      whatsappName: waName && waName !== name ? waName : null,
      patientIds: idsByContact.get(c.id) ?? [],
    });
  }
  return out;
}
