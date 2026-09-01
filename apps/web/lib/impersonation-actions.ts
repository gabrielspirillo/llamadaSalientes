'use server';

import { IMPERSONATION_COOKIE, findTenantById } from '@/lib/impersonation';
import { getCurrentTenant } from '@/lib/tenant';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export type ImpersonateResult = { ok: true } | { ok: false; error: string };

/**
 * Futura "entra como" una clínica. Solo super-admin. Setea la cookie que hace
 * que getCurrentTenant resuelva a esa clínica en toda la app.
 */
export async function startImpersonationAction(targetTenantId: string): Promise<ImpersonateResult> {
  const { isSuperAdmin, realTenant } = await getCurrentTenant();
  if (!isSuperAdmin) {
    return { ok: false, error: 'No autorizado.' };
  }
  if (targetTenantId === realTenant.id) {
    return { ok: false, error: 'Ya estás en tu propia clínica.' };
  }

  const target = await findTenantById(targetTenantId);
  if (!target) {
    return { ok: false, error: 'Clínica no encontrada.' };
  }

  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, targetTenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Sesión de gestión acotada: 8 horas.
    maxAge: 60 * 60 * 8,
  });

  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}

/** Salir del modo "actuando como": limpia la cookie. */
export async function stopImpersonationAction(): Promise<ImpersonateResult> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
  revalidatePath('/dashboard', 'layout');
  return { ok: true };
}
