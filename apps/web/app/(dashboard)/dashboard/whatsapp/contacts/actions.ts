'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { auditLogs, whatsappContacts } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

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
