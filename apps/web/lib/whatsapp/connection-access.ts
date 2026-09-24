import 'server-only';

import { findProfessionalForClerkUser, isAgendaOnly } from '@/lib/agenda/access';
import { type TenantRole, normalizeRole, resolveTenantRole } from '@/lib/auth/tenant-role';
import { auth } from '@clerk/nextjs/server';

/**
 * Quién puede vincular o desvincular el WhatsApp de la clínica: su
 * administrador (y Futura, que gestiona por encima).
 *
 * El rol sale de `resolveTenantRole()` y, si no hay fila en
 * `tenant_memberships`, del rol de la organización de Clerk. Esa tabla es una
 * caché que llena un webhook: si no corrió —clínica creada antes, endpoint mal
 * configurado— el dueño se quedaba sin rol, sin botón y sin poder conectar su
 * propio número. Clerk es la fuente de verdad, igual que en la agenda.
 *
 * Único sitio donde se decide: lo usan la página (para pintar los botones) y
 * las Server Actions (para imponerlo), que es lo que evita que la UI ofrezca
 * algo que el servidor va a rechazar, o al revés.
 */
export async function canManageWhatsappConnection(): Promise<boolean> {
  const [ctx, session] = await Promise.all([resolveTenantRole(), auth()]);
  const role: TenantRole = ctx.role ?? normalizeRole(session.orgRole);
  if (!ctx.isSuperAdmin && role !== 'admin') return false;

  // Un profesional con acceso restringido a su agenda no toca el resto del
  // panel, ni aunque su rol diga admin.
  const professional = await findProfessionalForClerkUser(ctx.tenantId, ctx.clerkUserId);
  return !isAgendaOnly(professional, { role, isSuperAdmin: ctx.isSuperAdmin });
}
