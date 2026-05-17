import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { clerkClient } from '@clerk/nextjs/server';

import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';

export interface TenantMember {
  userId: string; // internal users.id
  clerkUserId: string;
  email: string;
  role: string;
}

/**
 * Devuelve los miembros de una organización de Clerk, sincronizando
 * `users` y `tenant_memberships` locales sobre la marcha.
 *
 * Por qué Clerk es la fuente de verdad:
 *   - Los webhooks pueden no haber corrido para usuarios pre-existentes.
 *   - Cuando el admin agrega/elimina miembros desde Clerk, queremos verlo
 *     reflejado de inmediato en el dashboard sin esperar al webhook.
 *   - `tenant_memberships` queda como caché útil para joins / RLS futura.
 */
export async function listTenantMembersSynced(
  tenantId: string,
  clerkOrganizationId: string,
): Promise<TenantMember[]> {
  let memberships: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof clerkClient>>['organizations']['getOrganizationMembershipList']
    >
  >['data'];
  try {
    const cc = await clerkClient();
    const res = await cc.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      limit: 100,
    });
    memberships = res.data;
  } catch (err) {
    console.error('[tenant-members] clerk fetch failed, falling back to local table', {
      err: (err as Error).message,
    });
    return readLocalMembers(tenantId);
  }

  if (!memberships || memberships.length === 0) {
    return readLocalMembers(tenantId);
  }

  const parsed = memberships
    .map((m) => {
      const clerkUserId = m.publicUserData?.userId ?? null;
      const email = m.publicUserData?.identifier ?? null;
      const role = (m.role ?? 'org:member').replace(/^org:/, '');
      return clerkUserId && email ? { clerkUserId, email, role } : null;
    })
    .filter((x): x is { clerkUserId: string; email: string; role: string } => x !== null);

  if (parsed.length === 0) return readLocalMembers(tenantId);

  // 1) Upsert users por clerk_user_id. En conflicto, actualizamos email
  //    (puede haber cambiado en Clerk).
  await db
    .insert(users)
    .values(parsed.map((p) => ({ clerkUserId: p.clerkUserId, email: p.email })))
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email: sql`EXCLUDED.email` },
    });

  // 2) Recuperar ids internos.
  const clerkIds = parsed.map((p) => p.clerkUserId);
  const userRows = await db
    .select({ id: users.id, clerkUserId: users.clerkUserId, email: users.email })
    .from(users)
    .where(inArray(users.clerkUserId, clerkIds));
  const idMap = new Map<string, { id: string; email: string }>();
  for (const u of userRows) idMap.set(u.clerkUserId, { id: u.id, email: u.email });

  // 3) Sincronizar tenant_memberships. PK compuesta (tenant_id, user_id);
  //    en conflicto actualizamos role para reflejar cambios desde Clerk.
  const membershipRows = parsed
    .map((p) => {
      const local = idMap.get(p.clerkUserId);
      return local ? { tenantId, userId: local.id, role: p.role } : null;
    })
    .filter((x): x is { tenantId: string; userId: string; role: string } => x !== null);
  if (membershipRows.length > 0) {
    await db
      .insert(tenantMemberships)
      .values(membershipRows)
      .onConflictDoUpdate({
        target: [tenantMemberships.tenantId, tenantMemberships.userId],
        set: { role: sql`EXCLUDED.role` },
      });
  }

  return parsed
    .map((p) => {
      const local = idMap.get(p.clerkUserId);
      return local
        ? { userId: local.id, clerkUserId: p.clerkUserId, email: local.email, role: p.role }
        : null;
    })
    .filter((x): x is TenantMember => x !== null)
    .sort((a, b) => a.email.localeCompare(b.email));
}

async function readLocalMembers(tenantId: string): Promise<TenantMember[]> {
  const rows = await db
    .select({
      userId: users.id,
      clerkUserId: users.clerkUserId,
      email: users.email,
      role: tenantMemberships.role,
    })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.tenantId, tenantId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * Valida que `userId` es miembro del tenant. Si no aparece en la tabla local,
 * refresca desde Clerk y vuelve a chequear.
 */
export async function userIsTenantMember(
  tenantId: string,
  clerkOrganizationId: string,
  userId: string,
): Promise<boolean> {
  const localRows = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
    .limit(1);
  if (localRows.length > 0) return true;

  await listTenantMembersSynced(tenantId, clerkOrganizationId);
  const refreshed = await db
    .select({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)))
    .limit(1);
  return refreshed.length > 0;
}
