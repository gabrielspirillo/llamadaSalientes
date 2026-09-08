import 'server-only';
import { and, eq } from 'drizzle-orm';

import { ensureInternalUserId } from '@/lib/auth/internal-user';
import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { getCurrentTenant } from '@/lib/tenant';

/** Los tres roles del producto. Clerk guarda otros (`member`, `org:admin`…): ver `normalizeRole`. */
export type TenantRole = 'admin' | 'operator' | 'viewer';

export const ROLE_ORDER: Record<TenantRole, number> = { viewer: 0, operator: 1, admin: 2 };

/** `role` alcanza `min` en la jerarquía viewer < operator < admin. */
export function roleSatisfies(role: TenantRole, min: TenantRole): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[min];
}

export function normalizeRole(raw: string | null | undefined): TenantRole {
  const v = (raw ?? '').replace(/^org:/, '');
  if (v === 'admin') return 'admin';
  if (v === 'viewer') return 'viewer';
  // basic_member / member / operator y cualquier otro rol de Clerk operan.
  return 'operator';
}

interface TenantRoleBase {
  tenantId: string;
  clerkOrganizationId: string;
  clerkUserId: string;
  /** Refleja SIEMPRE al usuario real, aunque esté gestionando otra clínica. */
  isSuperAdmin: boolean;
  impersonating: boolean;
}

export type TenantRoleContext =
  | (TenantRoleBase & { role: TenantRole; internalUserId: string })
  /** Ni miembro de la clínica ni Futura: el gate que llame decide qué hacer. */
  | (TenantRoleBase & { role: null; internalUserId: null });

/**
 * Rol del usuario logueado en la clínica activa. Única fuente para todos los
 * gates del panel (tareas, mensajes, recordatorios, lista de espera, agenda)
 * y para las páginas que pintan la UI según el rol.
 *
 * Reglas:
 *   - Futura (super-admin) es `admin` en CUALQUIER clínica. Entra impersonando
 *     y no es miembro de la clínica gestionada, así que no tiene fila en
 *     `tenant_memberships`; hasta que existió esta función cada gate la
 *     buscaba, no la encontraba y la degradaba a `viewer`: Futura no podía ni
 *     probar los asistentes de la clínica que gestiona.
 *   - El resto sale de `tenant_memberships` (caché que llena el webhook de
 *     Clerk), normalizado con `normalizeRole`.
 *   - Sin fila y sin ser Futura, `role` es null. La agenda cae al rol de la
 *     organización de Clerk; los gates que escriben con el `users.id` interno
 *     rechazan, porque sin fila tampoco hay a quién atribuir la escritura.
 *
 * `internalUserId` es el `users.id` que referencian las FK (creador de una
 * tarea, autor de un comentario…). Para Futura se garantiza que exista aunque
 * el webhook de Clerk no la haya sincronizado nunca.
 */
export async function resolveTenantRole(): Promise<TenantRoleContext> {
  const { tenant, userId: clerkUserId, isSuperAdmin, impersonating } = await getCurrentTenant();

  const [m] = await db
    .select({ role: tenantMemberships.role, internalUserId: users.id })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)))
    .limit(1);

  const base: TenantRoleBase = {
    tenantId: tenant.id,
    clerkOrganizationId: tenant.clerkOrganizationId,
    clerkUserId,
    isSuperAdmin: Boolean(isSuperAdmin),
    impersonating: Boolean(impersonating),
  };

  if (isSuperAdmin) {
    // Manda aunque su fila (si la tiene) diga otra cosa: el super-admin lo es
    // por pertenecer a la organización de Futura, no por un rol de Clerk.
    return {
      ...base,
      role: 'admin',
      internalUserId: m?.internalUserId ?? (await ensureInternalUserId(clerkUserId)),
    };
  }

  if (!m) return { ...base, role: null, internalUserId: null };

  return { ...base, role: normalizeRole(m.role), internalUserId: m.internalUserId };
}
