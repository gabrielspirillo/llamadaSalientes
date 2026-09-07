'use server';

import { clinicNameSchema } from '@/lib/branding';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { brandingBucket } from '@/lib/futura/branding-store';
import { mediaDelete } from '@/lib/storage/media';
import { getCurrentTenant } from '@/lib/tenant';
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
