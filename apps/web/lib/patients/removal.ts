import 'server-only';
import { type AnyColumn, and, count, desc, eq, gte, inArray, ne, or } from 'drizzle-orm';

import {
  contactRefsFor,
  patientIdFromKey,
  patientKeyForPerson,
  phoneFromPatientKey,
  samePhone,
} from '@/lib/agenda/patients';
import { parseGuardians } from '@/lib/care-profile/policy';
import { db } from '@/lib/db/client';
import {
  agendaAppointments,
  appointmentReminders,
  appointmentsCache,
  clinicalNotes,
  invoices,
  patientCharges,
  patientConsents,
  patients,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { titleCaseName } from '@/lib/patients/names';
import {
  type PatientScope,
  PatientValidationError,
  mergePatients,
  patientFullName,
} from '@/lib/patients/persons';
import { findPatientByPhone, upsertPatientRecord } from '@/lib/patients/registry';

/**
 * Quitar a un paciente o contacto de la clínica, con o sin historia, y unir
 * fichas duplicadas eligiendo cualquiera de ellas como la que se queda.
 *
 * Una fila de la lista de pacientes puede ser tres cosas: una ficha de
 * paciente (`pat:`), un contacto de la libreta (`tel:`) o citas sueltas con
 * otra identidad (`ghl:`, `email:`, `anon:`). Todo lo de aquí trabaja con esa
 * clave para que el panel no tenga que saber cuál es cuál.
 */

export interface RemovalPreview {
  name: string;
  kind: 'PATIENT' | 'CONTACT' | 'APPOINTMENTS';
  appointments: number;
  futureAppointments: number;
  notes: number;
  charges: number;
  consents: number;
  /** Facturas emitidas: NO se borran (son documentos legales), quedan en Finanzas. */
  invoices: number;
  messages: number;
}

interface Target {
  kind: RemovalPreview['kind'];
  name: string;
  patientId: string | null;
  contactId: string | null;
  /** Todas las claves con las que pueden estar guardadas sus citas y notas. */
  keys: string[];
}

async function resolveTarget(tenantId: string, patientKey: string): Promise<Target | null> {
  const patientId = patientIdFromKey(patientKey);
  if (patientId) {
    const [row] = await db
      .select({ firstName: patients.firstName, lastName: patients.lastName })
      .from(patients)
      .where(and(eq(patients.tenantId, tenantId), eq(patients.id, patientId)))
      .limit(1);
    if (!row) return null;
    return {
      kind: 'PATIENT',
      name: patientFullName(row),
      patientId,
      contactId: null,
      keys: [patientKey],
    };
  }

  const phone = phoneFromPatientKey(patientKey);
  const contact = phone ? await findPatientByPhone(tenantId, phone) : null;
  const keys = new Set([patientKey]);
  if (contact) {
    for (const ref of contactRefsFor({
      ghlContactId: contact.ghlContactId,
      phone: contact.phoneE164,
      email: contact.email,
    })) {
      keys.add(ref);
    }
  }
  const [last] = await db
    .select({ name: agendaAppointments.patientName })
    .from(agendaAppointments)
    .where(
      and(eq(agendaAppointments.tenantId, tenantId), eq(agendaAppointments.patientKey, patientKey)),
    )
    .orderBy(desc(agendaAppointments.startsAt))
    .limit(1);
  const name = contact?.name?.trim() || last?.name || contact?.phoneE164 || patientKey;
  if (!contact && !last) return null;
  return {
    kind: contact ? 'CONTACT' : 'APPOINTMENTS',
    name,
    patientId: null,
    contactId: contact?.id ?? null,
    keys: [...keys],
  };
}

function ownedBy(target: Target, table: { patientKey: AnyColumn; patientId: AnyColumn }) {
  const byKey = inArray(table.patientKey, target.keys);
  return target.patientId ? or(byKey, eq(table.patientId, target.patientId)) : byKey;
}

export async function previewRemoval(
  tenantId: string,
  patientKey: string,
): Promise<RemovalPreview | null> {
  const target = await resolveTarget(tenantId, patientKey);
  if (!target) return null;
  const now = new Date();
  const [[appts], [future], [notes], [charges], [consents], [issued], [messages]] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(agendaAppointments)
        .where(and(eq(agendaAppointments.tenantId, tenantId), ownedBy(target, agendaAppointments))),
      db
        .select({ n: count() })
        .from(agendaAppointments)
        .where(
          and(
            eq(agendaAppointments.tenantId, tenantId),
            ownedBy(target, agendaAppointments),
            gte(agendaAppointments.startsAt, now),
            ne(agendaAppointments.status, 'CANCELLED'),
          ),
        ),
      db
        .select({ n: count() })
        .from(clinicalNotes)
        .where(and(eq(clinicalNotes.tenantId, tenantId), ownedBy(target, clinicalNotes))),
      db
        .select({ n: count() })
        .from(patientCharges)
        .where(and(eq(patientCharges.tenantId, tenantId), ownedBy(target, patientCharges))),
      target.patientId
        ? db
            .select({ n: count() })
            .from(patientConsents)
            .where(
              and(
                eq(patientConsents.tenantId, tenantId),
                eq(patientConsents.patientId, target.patientId),
              ),
            )
        : Promise.resolve([{ n: 0 }]),
      db
        .select({ n: count() })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), ownedBy(target, invoices))),
      target.contactId
        ? db
            .select({ n: count() })
            .from(whatsappMessages)
            .innerJoin(
              whatsappConversations,
              eq(whatsappConversations.id, whatsappMessages.conversationId),
            )
            .where(
              and(
                eq(whatsappConversations.tenantId, tenantId),
                eq(whatsappConversations.contactId, target.contactId),
              ),
            )
        : Promise.resolve([{ n: 0 }]),
    ]);
  return {
    name: target.name,
    kind: target.kind,
    appointments: Number(appts?.n ?? 0),
    futureAppointments: Number(future?.n ?? 0),
    notes: Number(notes?.n ?? 0),
    charges: Number(charges?.n ?? 0),
    consents: Number(consents?.n ?? 0),
    invoices: Number(issued?.n ?? 0),
    messages: Number(messages?.n ?? 0),
  };
}

/**
 * Borra al paciente o contacto y TODO lo suyo: citas, notas, cobros,
 * consentimientos y, si es un contacto, sus conversaciones de WhatsApp. Las
 * facturas emitidas se conservan (son documentos legales y numerados) y
 * quedan sin paciente enlazado. Los recordatorios pendientes de sus citas se
 * cancelan para que no le llegue nada. Irreversible: el panel lo confirma.
 */
export async function removePatientEverywhere(
  scope: PatientScope,
  patientKey: string,
): Promise<void> {
  const target = await resolveTarget(scope.tenantId, patientKey);
  if (!target) throw new PatientValidationError('Ese paciente ya no existe.');
  const tenantId = scope.tenantId;

  await db.transaction(async (tx) => {
    const appts = await tx
      .select({ id: agendaAppointments.id })
      .from(agendaAppointments)
      .where(and(eq(agendaAppointments.tenantId, tenantId), ownedBy(target, agendaAppointments)));
    const apptIds = appts.map((a) => a.id);

    if (apptIds.length > 0) {
      await tx
        .update(appointmentReminders)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(
          and(
            eq(appointmentReminders.tenantId, tenantId),
            inArray(appointmentReminders.ghlAppointmentId, apptIds),
            eq(appointmentReminders.status, 'SCHEDULED'),
          ),
        );
      await tx
        .delete(appointmentsCache)
        .where(
          and(
            eq(appointmentsCache.tenantId, tenantId),
            inArray(appointmentsCache.ghlAppointmentId, apptIds),
          ),
        );
    }

    await tx
      .delete(patientCharges)
      .where(
        and(
          eq(patientCharges.tenantId, tenantId),
          apptIds.length > 0
            ? or(ownedBy(target, patientCharges), inArray(patientCharges.appointmentId, apptIds))
            : ownedBy(target, patientCharges),
        ),
      );
    await tx
      .delete(clinicalNotes)
      .where(and(eq(clinicalNotes.tenantId, tenantId), ownedBy(target, clinicalNotes)));
    if (apptIds.length > 0) {
      await tx
        .delete(agendaAppointments)
        .where(
          and(eq(agendaAppointments.tenantId, tenantId), inArray(agendaAppointments.id, apptIds)),
        );
    }
    if (target.patientId) {
      await tx
        .delete(patients)
        .where(and(eq(patients.tenantId, tenantId), eq(patients.id, target.patientId)));
    }
    if (target.contactId) {
      await tx
        .delete(whatsappContacts)
        .where(
          and(eq(whatsappContacts.tenantId, tenantId), eq(whatsappContacts.id, target.contactId)),
        );
    }
  });
}

// ─── Unir fichas ─────────────────────────────────────────────────────────────

/**
 * Une varias filas de la lista en una. `keepKey` es la que el usuario eligió
 * como la que se queda, sea del tipo que sea:
 *
 * - Si entre ellas hay una ficha de paciente, el resultado es SIEMPRE una
 *   ficha de paciente: es la que guarda fecha de nacimiento, anamnesis,
 *   tutores y consentimientos, y perderla sería perder historia. Si se eligió
 *   otra fila, su nombre y su teléfono pasan a esa ficha.
 * - Si no hay ninguna, las citas y notas de las demás pasan a la elegida.
 *
 * Los teléfonos de las filas unidas quedan como tutores de la ficha: así ese
 * contacto deja de salir como paciente aparte y los asistentes encuentran al
 * niño cuando escriben desde ese número.
 */
export async function mergePatientRecords(
  scope: PatientScope,
  keepKey: string,
  dropKeys: string[],
): Promise<{ patientKey: string; moved: number }> {
  const all = [...new Set([keepKey, ...dropKeys].map((k) => k.trim()).filter(Boolean))];
  if (all.length < 2) throw new PatientValidationError('Elige al menos dos fichas para unir.');

  const targets = new Map<string, Target>();
  for (const key of all) {
    const t = await resolveTarget(scope.tenantId, key);
    if (!t) throw new PatientValidationError('Una de las fichas ya no existe. Recarga la página.');
    targets.set(key, t);
  }
  const keep = targets.get(keepKey);
  if (!keep) throw new PatientValidationError('La ficha que se queda ya no existe.');

  const personKey = keep.patientId ? keepKey : all.find((k) => targets.get(k)?.patientId);

  if (personKey) {
    const personId = patientIdFromKey(personKey) as string;
    const drops = all.filter((k) => k !== personKey);
    const { moved } = await mergePatients(scope, personId, drops);

    // Teléfonos de lo unido → tutores de la ficha (si no estaban ya).
    const [person] = await db
      .select({
        firstName: patients.firstName,
        lastName: patients.lastName,
        guardians: patients.guardians,
        contactPhone: whatsappContacts.phoneE164,
      })
      .from(patients)
      .leftJoin(whatsappContacts, eq(whatsappContacts.id, patients.contactId))
      .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, personId)))
      .limit(1);
    const guardians = parseGuardians(person?.guardians);
    const known = [person?.contactPhone, ...guardians.map((g) => g.phone)];
    for (const key of drops) {
      const phone = phoneFromPatientKey(key);
      if (!phone || known.some((p) => samePhone(p, phone)) || guardians.length >= 4) continue;
      // La fila suele llevar el nombre del niño, no el del tutor: no se copia.
      const rowName = targets.get(key)?.name ?? '';
      const isChildName =
        nameForMatch(rowName) === nameForMatch(person ? patientFullName(person) : keep.name);
      guardians.push({
        role: 'OTRO',
        name: isChildName || /^\+?\d/.test(rowName) ? 'Otro contacto' : titleCaseName(rowName),
        phone,
        primary: false,
      });
      known.push(phone);
    }

    const patch: Partial<typeof patients.$inferInsert> = { guardians };
    if (!keep.patientId) {
      // Eligieron la otra fila: su nombre y su teléfono mandan.
      const parts = titleCaseName(keep.name).split(/\s+/).filter(Boolean);
      if (parts.length > 0 && !/^\+?\d[\d\s]*$/.test(keep.name)) {
        patch.firstName = parts[0];
        patch.lastName = parts.slice(1).join(' ') || null;
      }
      const phone = phoneFromPatientKey(keepKey);
      if (phone) {
        const contact = await upsertPatientRecord({ tenantId: scope.tenantId, phone });
        if (contact) patch.contactId = contact.id;
      }
    }
    await db
      .update(patients)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(patients.tenantId, scope.tenantId), eq(patients.id, personId)));
    return { patientKey: patientKeyForPerson(personId), moved };
  }

  // Sin ficha de paciente: todo pasa a la clave elegida.
  let moved = 0;
  await db.transaction(async (tx) => {
    for (const key of all) {
      if (key === keepKey) continue;
      const appts = await tx
        .update(agendaAppointments)
        .set({ patientKey: keepKey, patientName: keep.name })
        .where(
          and(
            eq(agendaAppointments.tenantId, scope.tenantId),
            eq(agendaAppointments.patientKey, key),
          ),
        )
        .returning({ id: agendaAppointments.id });
      const notes = await tx
        .update(clinicalNotes)
        .set({ patientKey: keepKey, patientName: keep.name })
        .where(and(eq(clinicalNotes.tenantId, scope.tenantId), eq(clinicalNotes.patientKey, key)))
        .returning({ id: clinicalNotes.id });
      await tx
        .update(patientCharges)
        .set({ patientKey: keepKey })
        .where(
          and(eq(patientCharges.tenantId, scope.tenantId), eq(patientCharges.patientKey, key)),
        );
      await tx
        .update(invoices)
        .set({ patientKey: keepKey })
        .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.patientKey, key)));
      moved += appts.length + notes.length;

      // El contacto que se queda sin nada no vuelve a salir como paciente
      // aparte: si no tiene conversaciones, se borra.
      const contactId = targets.get(key)?.contactId;
      if (contactId && contactId !== keep.contactId) {
        const [conv] = await tx
          .select({ n: count() })
          .from(whatsappConversations)
          .where(
            and(
              eq(whatsappConversations.tenantId, scope.tenantId),
              eq(whatsappConversations.contactId, contactId),
            ),
          );
        if (Number(conv?.n ?? 0) === 0) {
          await tx
            .delete(whatsappContacts)
            .where(
              and(
                eq(whatsappContacts.tenantId, scope.tenantId),
                eq(whatsappContacts.id, contactId),
              ),
            );
        }
      }
    }
  });
  return { patientKey: keepKey, moved };
}

function nameForMatch(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
