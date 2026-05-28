'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import {
  auditLogs,
  users,
  whatsappContactNotes,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}
function fail<T = never>(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<T> {
  return { success: false, error, fieldErrors };
}

const urlOrEmpty = z.string().url().or(z.literal(''));

const updateSchema = z.object({
  contactId: z.string().uuid(),
  firstName: z.string().max(80).optional().nullable(),
  lastName: z.string().max(80).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  city: z.string().max(120).optional().nullable(),
  country: z.string().max(80).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  company: z.string().max(120).optional().nullable(),
  socialLinks: z
    .object({
      linkedin: urlOrEmpty.optional(),
      facebook: urlOrEmpty.optional(),
      instagram: urlOrEmpty.optional(),
      twitter: urlOrEmpty.optional(),
      github: urlOrEmpty.optional(),
    })
    .optional()
    .default({}),
});

/**
 * Actualiza los detalles del contacto WhatsApp localmente y, best-effort,
 * pushea a GHL los campos que soporta (firstName, lastName, email).
 * Los campos extra (city/country/address/company/socialLinks) viven solo
 * localmente por ahora — en el futuro se mapearán a custom fields de GHL.
 *
 * El `name` (legacy, display) se recompone como "first last" cuando hay
 * cambios para que el inbox lo siga mostrando coherente.
 */
export async function updateContactDetails(
  input: unknown,
): Promise<ActionResult<{ contactId: string }>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  }
  const { tenant } = await getCurrentTenant();

  // Cargar para verificar ownership + tener phone/ghlContactId para sync.
  const rows = await db
    .select()
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.id, parsed.data.contactId),
        eq(whatsappContacts.tenantId, tenant.id),
      ),
    )
    .limit(1);
  const contact = rows[0];
  if (!contact) return fail('Contacto no encontrado');

  const firstName = sanitize(parsed.data.firstName);
  const lastName = sanitize(parsed.data.lastName);
  const email = sanitize(parsed.data.email);
  const composedName = [firstName, lastName].filter(Boolean).join(' ') || contact.name;

  await db
    .update(whatsappContacts)
    .set({
      firstName,
      lastName,
      name: composedName,
      email,
      city: sanitize(parsed.data.city),
      country: sanitize(parsed.data.country),
      address: sanitize(parsed.data.address),
      company: sanitize(parsed.data.company),
      socialLinks: pruneSocial(parsed.data.socialLinks ?? {}),
      updatedAt: new Date(),
    })
    .where(eq(whatsappContacts.id, contact.id));

  // Best-effort sync a GHL. No tira si GHL no está conectado o falla.
  if (contact.ghlContactId) {
    try {
      const { updateContact } = await import('@/lib/ghl/contacts-mutations');
      await updateContact(tenant.id, contact.ghlContactId, {
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        email: email ?? undefined,
      });
    } catch (err) {
      console.warn('[updateContactDetails] GHL sync failed', {
        contactId: contact.id,
        ghlContactId: contact.ghlContactId,
        err: (err as Error).message,
      });
    }
  }

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      action: 'wa_contact_details_updated',
      entity: 'whatsapp_contact',
      entityId: contact.id,
      after: {
        firstName,
        lastName,
        email,
        ghlSynced: !!contact.ghlContactId,
      } as never,
    });
  } catch (err) {
    console.error('audit_failed', err);
  }

  revalidatePath(`/dashboard/whatsapp/contacts/${contact.id}`);
  revalidatePath('/dashboard/whatsapp');
  return ok({ contactId: contact.id });
}

// ─── Notas del contacto ───────────────────────────────────────────────────

async function getInternalUserId(): Promise<string | null> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function assertContactInTenant(tenantId: string, contactId: string) {
  const rows = await db
    .select({ id: whatsappContacts.id })
    .from(whatsappContacts)
    .where(and(eq(whatsappContacts.id, contactId), eq(whatsappContacts.tenantId, tenantId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

const addNoteSchema = z.object({
  contactId: z.string().uuid(),
  body: z.string().min(1).max(8000),
});

export async function addContactNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addNoteSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos', parsed.error.flatten().fieldErrors);
  const { tenant } = await getCurrentTenant();
  if (!(await assertContactInTenant(tenant.id, parsed.data.contactId))) {
    return fail('Contacto no encontrado');
  }
  const authorUserId = await getInternalUserId();
  const [row] = await db
    .insert(whatsappContactNotes)
    .values({
      tenantId: tenant.id,
      contactId: parsed.data.contactId,
      body: parsed.data.body.trim(),
      authorUserId,
    })
    .returning({ id: whatsappContactNotes.id });

  revalidatePath(`/dashboard/whatsapp/contacts/${parsed.data.contactId}`);
  return ok({ id: row!.id });
}

const deleteNoteSchema = z.object({ id: z.string().uuid(), contactId: z.string().uuid() });

export async function deleteContactNote(input: unknown): Promise<ActionResult<null>> {
  const parsed = deleteNoteSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  await db
    .delete(whatsappContactNotes)
    .where(
      and(
        eq(whatsappContactNotes.id, parsed.data.id),
        eq(whatsappContactNotes.tenantId, tenant.id),
      ),
    );
  revalidatePath(`/dashboard/whatsapp/contacts/${parsed.data.contactId}`);
  return ok(null);
}

// ─── Combinar contactos ───────────────────────────────────────────────────

const searchSchema = z.object({
  query: z.string().min(1).max(80),
  excludeId: z.string().uuid(),
});

export async function searchContactsForMerge(input: unknown): Promise<
  ActionResult<
    Array<{ id: string; name: string | null; phoneE164: string; ghlContactId: string | null }>
  >
> {
  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  const { tenant } = await getCurrentTenant();
  const q = `%${parsed.data.query.trim()}%`;
  const rows = await db
    .select({
      id: whatsappContacts.id,
      name: whatsappContacts.name,
      phoneE164: whatsappContacts.phoneE164,
      ghlContactId: whatsappContacts.ghlContactId,
    })
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.tenantId, tenant.id),
        ne(whatsappContacts.id, parsed.data.excludeId),
        or(ilike(whatsappContacts.name, q), ilike(whatsappContacts.phoneE164, q)),
      ),
    )
    .orderBy(desc(whatsappContacts.updatedAt))
    .limit(10);
  return ok(rows);
}

const mergeSchema = z.object({
  /** El contacto que QUEDA (destino del merge). */
  targetId: z.string().uuid(),
  /** El contacto que se borra (sus conversaciones, notas y mensajes se re-apuntan al target). */
  sourceId: z.string().uuid(),
});

/**
 * Mergea dos contactos. Todo lo que apunta al `sourceId` se re-apunta al
 * `targetId` (conversaciones, notas, mensajes con conversation_id de las
 * conversaciones movidas). El sourceId se borra al final.
 *
 * Campos del contacto: si el target tenía vacío y el source tenía algo,
 * copiamos del source. Si los dos tenían algo, gana el target (no
 * pisamos lo que el operador puso en el "principal").
 */
export async function mergeContacts(input: unknown): Promise<ActionResult<{ targetId: string }>> {
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return fail('Datos inválidos');
  if (parsed.data.sourceId === parsed.data.targetId) {
    return fail('No se puede combinar un contacto consigo mismo');
  }
  const { tenant } = await getCurrentTenant();
  const actorUserId = await getInternalUserId();

  const rows = await db
    .select()
    .from(whatsappContacts)
    .where(
      and(
        eq(whatsappContacts.tenantId, tenant.id),
        inArray(whatsappContacts.id, [parsed.data.sourceId, parsed.data.targetId]),
      ),
    );
  const target = rows.find((r) => r.id === parsed.data.targetId);
  const source = rows.find((r) => r.id === parsed.data.sourceId);
  if (!target || !source) return fail('Alguno de los contactos no existe');

  // 1. Re-apuntar conversaciones del source al target.
  await db
    .update(whatsappConversations)
    .set({ contactId: target.id, updatedAt: new Date() })
    .where(eq(whatsappConversations.contactId, source.id));

  // 2. Re-apuntar notas del source al target.
  await db
    .update(whatsappContactNotes)
    .set({ contactId: target.id, updatedAt: new Date() })
    .where(eq(whatsappContactNotes.contactId, source.id));

  // 3. Backfill de campos vacíos del target con los del source.
  const merged: Partial<typeof whatsappContacts.$inferInsert> = {
    name: target.name ?? source.name,
    firstName: target.firstName ?? source.firstName,
    lastName: target.lastName ?? source.lastName,
    email: target.email ?? source.email,
    avatarUrl: target.avatarUrl ?? source.avatarUrl,
    city: target.city ?? source.city,
    country: target.country ?? source.country,
    address: target.address ?? source.address,
    company: target.company ?? source.company,
    ghlContactId: target.ghlContactId ?? source.ghlContactId,
    socialLinks: mergeSocial(target.socialLinks, source.socialLinks),
    updatedAt: new Date(),
  };
  await db.update(whatsappContacts).set(merged).where(eq(whatsappContacts.id, target.id));

  // 4. Borrar source (ON DELETE CASCADE limpia lo que quede).
  await db.delete(whatsappContacts).where(eq(whatsappContacts.id, source.id));

  // Touch updated_at de conversaciones movidas para que el inbox reordene.
  await db
    .update(whatsappConversations)
    .set({ updatedAt: new Date() })
    .where(eq(whatsappConversations.contactId, target.id));
  // (silenciamos warning de no-uso)
  void whatsappMessages;
  void sql;

  try {
    await db.insert(auditLogs).values({
      tenantId: tenant.id,
      actorUserId,
      action: 'wa_contacts_merged',
      entity: 'whatsapp_contact',
      entityId: target.id,
      after: { sourceId: source.id, targetId: target.id } as never,
    });
  } catch (err) {
    console.error('audit_failed', err);
  }

  revalidatePath(`/dashboard/whatsapp/contacts/${target.id}`);
  revalidatePath('/dashboard/whatsapp');
  return ok({ targetId: target.id });
}

function mergeSocial(
  a: unknown,
  b: unknown,
): Record<string, string> {
  const safe = (x: unknown): Record<string, string> =>
    x && typeof x === 'object' ? (x as Record<string, string>) : {};
  return { ...safe(b), ...safe(a) };
}

function sanitize(s: string | null | undefined): string | null {
  if (s == null) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function pruneSocial(s: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}
