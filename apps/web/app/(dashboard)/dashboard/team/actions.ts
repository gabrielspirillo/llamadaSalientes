'use server';

import { env } from '@/lib/env';
import { requireTaskRole } from '@/lib/tasks/auth';
import { getCurrentTenant } from '@/lib/tenant';
import { clerkClient } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({
  email: z.string().trim().email('Email inválido'),
  // org:member = Operador (permisos reducidos); org:admin = acceso completo.
  role: z.enum(['org:member', 'org:admin']),
});

export type InviteResult = { ok: true } | { ok: false; error: string };

/**
 * Invita a un miembro a la clínica (organización de Clerk) por email. Clerk
 * envía el mail de invitación; al aceptarlo, la persona queda vinculada a esta
 * clínica con el rol indicado. Reusa las invitaciones nativas de Clerk.
 */
export async function inviteMemberAction(input: {
  email: string;
  role: string;
}): Promise<InviteResult> {
  const { tenant, userId, impersonating } = await getCurrentTenant();
  if (!userId) {
    return { ok: false, error: 'No hay una clínica activa.' };
  }
  // La gestión de miembros usa la organización de Clerk de la clínica. Al
  // impersonar, el usuario de Futura NO es miembro de esa org (Clerk lo
  // rechazaría) y, sobre todo, jamás debemos invitar a la org de Futura. Se
  // hace desde la cuenta propia de la clínica.
  if (impersonating) {
    return {
      ok: false,
      error: 'El equipo de una clínica se gestiona desde su propia cuenta, no en modo Futura.',
    };
  }

  // Una Server Action es un endpoint POST invocable directamente: esconder el
  // formulario en la UI no impide que un `viewer` se autoinvite como
  // org:admin y se quede con el control de la clínica.
  try {
    await requireTaskRole('admin');
  } catch {
    return { ok: false, error: 'Solo un administrador puede invitar miembros.' };
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' };
  }

  try {
    const cc = await clerkClient();
    await cc.organizations.createOrganizationInvitation({
      organizationId: tenant.clerkOrganizationId,
      inviterUserId: userId,
      emailAddress: parsed.data.email,
      role: parsed.data.role,
      // Al aceptar la invitación, la persona cae en la app ya logueada.
      redirectUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard`,
    });

    revalidatePath('/dashboard/team');
    return { ok: true };
  } catch (err) {
    // Los errores de Clerk traen el detalle en `errors[].longMessage`; el
    // `.message` genérico suele ser sólo "Bad Request".
    const clerkErr = err as {
      errors?: Array<{ longMessage?: string; message?: string; code?: string }>;
      message?: string;
    };
    const detail = clerkErr.errors?.[0];
    let message =
      detail?.longMessage ??
      detail?.message ??
      clerkErr.message ??
      'No se pudo enviar la invitación.';

    // Traducción de los casos más comunes a algo claro en español.
    if (
      detail?.code === 'duplicate_record' ||
      /already a member|already been invited/i.test(message)
    ) {
      message = 'Esa persona ya es miembro o ya tiene una invitación pendiente.';
    }

    return { ok: false, error: message };
  }
}
