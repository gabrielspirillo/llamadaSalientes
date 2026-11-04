'use server';

import { clinicNameSchema } from '@/lib/branding';
import { ConsentError, upsertEsignIntegration } from '@/lib/consents/service';
import {
  type WhatsappAgentMode,
  isWhatsappAgentMode,
  setWhatsappAgentMode,
} from '@/lib/data/whatsapp-agent-settings';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { brandingBucket } from '@/lib/futura/branding-store';
import { mediaDelete } from '@/lib/storage/media';
import { getCurrentTenant } from '@/lib/tenant';
import { normalizeWhatsappE164 } from '@/lib/whatsapp/phone';
import { clerkClient } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export type ActivateResult = { ok: true } | { ok: false; error: string };

/**
 * Activa una clínica (status → 'active'). Solo Futura (super-admin). Es el
 * paso final del alta: la clínica completó el onboarding y quedó 'pending';
 * acá Futura la deja operativa.
 */
export async function activateClinicAction(targetTenantId: string): Promise<ActivateResult> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }

  await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, targetTenantId));

  revalidatePath('/dashboard/futura');
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}

/**
 * Resultado de las acciones de marca. `warning` existe para el caso en que el
 * cambio SÍ se guardó pero algo secundario falló (típicamente Clerk): decir
 * "error" ahí haría que quien lo usa reintente un cambio que ya está hecho.
 */
export type BrandingResult = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Cambia el nombre de una clínica. Solo Futura (super-admin).
 *
 * El nombre vive en dos sitios: la fila de `tenants` (que es lo que lee el
 * panel) y la organización de Clerk (que es lo que dibuja el selector de
 * organizaciones del sidebar). Cambiar sólo uno deja al usuario viendo dos
 * nombres distintos en la misma pantalla, así que se escriben los dos.
 *
 * Orden: primero la base, que es de donde se sirve el panel; después Clerk. Si
 * Clerk falla el cambio no se pierde y se avisa de que el selector puede seguir
 * mostrando el nombre anterior.
 */
export async function renameClinicAction(
  targetTenantId: string,
  rawName: string,
): Promise<BrandingResult> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }

  const parsed = clinicNameSchema.safeParse(rawName);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Nombre no válido.' };
  }
  const name = parsed.data;

  const rows = await db
    .select({ id: tenants.id, clerkOrganizationId: tenants.clerkOrganizationId })
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return { ok: false, error: 'La clínica no existe.' };
  }

  await db.update(tenants).set({ name }).where(eq(tenants.id, target.id));

  let warning: string | undefined;
  try {
    const cc = await clerkClient();
    await cc.organizations.updateOrganization(target.clerkOrganizationId, { name });
  } catch (err) {
    console.warn('[futura-branding] no se pudo renombrar la organización en Clerk', err);
    warning =
      'El nombre se guardó, pero no se pudo actualizar en Clerk: el selector de organizaciones puede seguir mostrando el anterior.';
  }

  revalidateBranding();
  return warning ? { ok: true, warning } : { ok: true };
}

/**
 * Quita el logo de una clínica: vuelve a la marca FUTURA por defecto.
 *
 * El borrado del objeto en el bucket es best-effort. Si falla, lo que importa
 * ya está hecho — la clínica dejó de mostrar ese logo — y tirar un error haría
 * que pareciera que no se quitó.
 */
export async function removeClinicLogoAction(targetTenantId: string): Promise<BrandingResult> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }

  const rows = await db
    .select({ id: tenants.id, logoPath: tenants.logoPath })
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .limit(1);
  const target = rows[0];
  if (!target) {
    return { ok: false, error: 'La clínica no existe.' };
  }

  await db.update(tenants).set({ logoUrl: null, logoPath: null }).where(eq(tenants.id, target.id));

  if (target.logoPath) {
    try {
      await mediaDelete(target.logoPath, { bucket: brandingBucket() });
    } catch (err) {
      console.warn('[futura-branding] no se pudo borrar el logo anterior', err);
    }
  }

  revalidateBranding();
  return { ok: true };
}

/**
 * La marca se dibuja en el layout del panel (sidebar y topbar), no sólo en la
 * página desde la que se cambia: hay que invalidar el layout entero o la
 * clínica sigue viendo el logo viejo hasta el próximo despliegue.
 */
function revalidateBranding(): void {
  revalidatePath('/dashboard/futura');
  revalidatePath('/dashboard', 'layout');
}

/**
 * Modo del asistente de WhatsApp de una clínica. Sólo Futura.
 *
 * Es una decisión de producto por cliente —hay centros que no quieren que el
 * asistente reserve nada— y por eso no se expone en la configuración de la
 * propia clínica: se enciende desde aquí.
 */
export async function setWhatsappAgentModeAction(
  targetTenantId: string,
  rawMode: string,
  rawFallbackPhone: string | null,
): Promise<BrandingResult> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }
  if (!isWhatsappAgentMode(rawMode)) {
    return { ok: false, error: 'Modo no válido.' };
  }
  const mode: WhatsappAgentMode = rawMode;

  const rawPhone = rawFallbackPhone?.trim() ?? '';
  const fallbackPhone = rawPhone ? normalizeWhatsappE164(rawPhone) : null;
  if (rawPhone && !fallbackPhone) {
    return {
      ok: false,
      error: 'El móvil de respaldo tiene que llevar el prefijo del país: +34 600 11 22 33.',
    };
  }

  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .limit(1);
  if (!rows[0]) {
    return { ok: false, error: 'La clínica no existe.' };
  }

  await setWhatsappAgentMode({
    tenantId: targetTenantId,
    mode,
    deriveFallbackPhone: fallbackPhone,
  });

  revalidatePath('/dashboard/futura');
  return mode === 'DERIVE' && !fallbackPhone
    ? {
        ok: true,
        warning:
          'Guardado. Sin móvil de respaldo, una consulta que no encaje con ningún profesional se queda sólo en el panel.',
      }
    : { ok: true };
}

/**
 * La instancia de Documenso de una clínica (firma digital del consentimiento).
 * Sólo Futura: es una decisión de producto por cliente, con secretos.
 */
export async function saveEsignIntegrationAction(
  targetTenantId: string,
  input: { baseUrl: string; apiToken: string; webhookSecret: string },
): Promise<BrandingResult> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, targetTenantId))
    .limit(1);
  if (!rows[0]) {
    return { ok: false, error: 'La clínica no existe.' };
  }
  try {
    await upsertEsignIntegration({ tenantId: targetTenantId, ...input });
  } catch (err) {
    if (err instanceof ConsentError) return { ok: false, error: err.message };
    console.error('[futura] firma digital', err);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
  revalidatePath('/dashboard/futura');
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}

// ─── Archivar / restaurar / eliminar clínicas ───────────────────────────────

export type ArchiveResult = { ok: true; warning?: string } | { ok: false; error: string };

async function requireSuperAdmin() {
  const ctx = await getCurrentTenant();
  if (!ctx.isSuperAdmin) throw new Error('No autorizado.');
  return ctx;
}

function refreshFutura() {
  revalidatePath('/dashboard/futura');
  revalidatePath('/dashboard', 'layout');
}

export async function archiveClinicAction(targetTenantId: string): Promise<ArchiveResult> {
  try {
    await requireSuperAdmin();
    const { archiveTenant } = await import('@/lib/tenants/archive');
    // Si se estaba gestionando esa clínica, `getCurrentTenant` deja de
    // respetar la cookie en cuanto está archivada.
    await archiveTenant(targetTenantId);
    refreshFutura();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'No se pudo archivar.' };
  }
}

export async function restoreClinicAction(targetTenantId: string): Promise<ArchiveResult> {
  try {
    await requireSuperAdmin();
    const { restoreTenant } = await import('@/lib/tenants/archive');
    await restoreTenant(targetTenantId);
    refreshFutura();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'No se pudo restaurar.' };
  }
}

/**
 * Elimina para siempre una clínica archivada. Primero la base (es lo que
 * importa y lo que no se puede dejar a medias); después la organización de
 * Clerk. Si Clerk falla, la clínica ya no existe y se avisa de que la
 * organización hay que borrarla a mano.
 */
export async function deleteClinicAction(
  targetTenantId: string,
  confirmName: string,
): Promise<ArchiveResult> {
  try {
    const ctx = await requireSuperAdmin();
    const { deleteArchivedTenant } = await import('@/lib/tenants/archive');
    const deleted = await deleteArchivedTenant(targetTenantId, confirmName);
    const { recordAudit } = await import('@/lib/audit');
    await recordAudit({
      tenantId: ctx.realTenant.id,
      actorUserId: null,
      action: 'delete',
      entity: 'tenant',
      entityId: targetTenantId,
      after: { name: deleted.name, clerkOrganizationId: deleted.clerkOrganizationId },
    }).catch(() => undefined);
    refreshFutura();
    try {
      await (await clerkClient()).organizations.deleteOrganization(deleted.clerkOrganizationId);
    } catch {
      return {
        ok: true,
        warning:
          'La clínica se eliminó, pero su organización en Clerk no. Bórrala desde el panel de Clerk.',
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'No se pudo eliminar.' };
  }
}

// ─── Equipo de Futura (super-admins) ────────────────────────────────────────

export type TeamResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Da acceso de super-admin: ser miembro de la organización de Futura en Clerk
 * es lo que convierte a alguien en super-admin (`isSuperAdminTenant`). Si la
 * persona ya tiene cuenta, entra al momento; si no, se le manda una
 * invitación por correo.
 */
export async function addFuturaMemberAction(rawEmail: string): Promise<TeamResult> {
  try {
    const ctx = await requireSuperAdmin();
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Ese correo no es válido.' };
    }
    const clerk = await clerkClient();
    const orgId = ctx.realTenant.clerkOrganizationId;
    const found = await clerk.users.getUserList({ emailAddress: [email] });
    const user = found.data[0];
    if (user) {
      const members = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 200,
      });
      if (members.data.some((m) => m.publicUserData?.userId === user.id)) {
        return { ok: true, message: `${email} ya es parte del equipo de Futura.` };
      }
      await clerk.organizations.createOrganizationMembership({
        organizationId: orgId,
        userId: user.id,
        role: 'org:admin',
      });
      revalidatePath('/dashboard/futura');
      return {
        ok: true,
        message: `${email} ya es super-admin. Lo verá al elegir "Futura" en el selector de organizaciones.`,
      };
    }
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.futuradigital.es').replace(
      /\/+$/,
      '',
    );
    await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: 'org:admin',
      redirectUrl: `${appUrl}/dashboard/futura`,
    });
    revalidatePath('/dashboard/futura');
    return {
      ok: true,
      message: `${email} todavía no tiene cuenta: le llegó una invitación por correo.`,
    };
  } catch (err) {
    const msg = (err as { errors?: { longMessage?: string; message?: string }[] }).errors?.[0];
    return { ok: false, error: msg?.longMessage || msg?.message || (err as Error).message };
  }
}

export async function removeFuturaMemberAction(clerkUserId: string): Promise<TeamResult> {
  try {
    const ctx = await requireSuperAdmin();
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (userId === clerkUserId) {
      return { ok: false, error: 'No puedes quitarte a ti. Que lo haga otra persona del equipo.' };
    }
    const clerk = await clerkClient();
    await clerk.organizations.deleteOrganizationMembership({
      organizationId: ctx.realTenant.clerkOrganizationId,
      userId: clerkUserId,
    });
    revalidatePath('/dashboard/futura');
    return { ok: true, message: 'Quitado del equipo de Futura.' };
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'No se pudo quitar.' };
  }
}
