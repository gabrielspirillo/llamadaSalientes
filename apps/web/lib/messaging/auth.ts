import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { imChannelMembers, imChannels, tenantMemberships, users } from '@/lib/db/schema';
import { type TaskRole, normalizeRole } from '@/lib/tasks/auth';
import { getCurrentTenant } from '@/lib/tenant';

/**
 * Gate de rol del módulo Mensajes. Reutiliza `tenant_memberships` y el
 * `normalizeRole()` de Tareas para no tener dos tablas de permisos.
 *
 * Criterio: `viewer` lee canales públicos y escribe en sus DM (es el perfil de
 * quien mira números sin operar); `operator` escribe en canales y convierte
 * mensajes en tareas; `admin` crea canales públicos, archiva y expulsa.
 */
export type MessagingRole = TaskRole;

const ORDER: Record<MessagingRole, number> = { viewer: 0, operator: 1, admin: 2 };

export class MessagingForbiddenError extends Error {
  constructor(
    public actual: MessagingRole,
    public required: MessagingRole,
  ) {
    super(`Rol ${actual} insuficiente, se requiere ${required}+`);
    this.name = 'MessagingForbiddenError';
  }
}

export class MessagingNotFoundError extends Error {
  constructor(what = 'Recurso') {
    super(`${what} no encontrado`);
    this.name = 'MessagingNotFoundError';
  }
}

export class NotChannelMemberError extends Error {
  constructor() {
    super('No sos miembro de este canal');
    this.name = 'NotChannelMemberError';
  }
}

export interface MessagingAuthContext {
  tenantId: string;
  clerkOrganizationId: string;
  /** users.id interno. */
  userId: string;
  clerkUserId: string;
  role: MessagingRole;
}

export async function requireMessagingRole(
  min: MessagingRole = 'viewer',
): Promise<MessagingAuthContext> {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  const [m] = await db
    .select({ role: tenantMemberships.role, internalUserId: users.id })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)))
    .limit(1);

  if (!m) throw new MessagingForbiddenError('viewer', min);

  const role = normalizeRole(m.role);
  if (ORDER[role] < ORDER[min]) throw new MessagingForbiddenError(role, min);

  return {
    tenantId: tenant.id,
    clerkOrganizationId: tenant.clerkOrganizationId,
    userId: m.internalUserId,
    clerkUserId,
    role,
  };
}

/**
 * Valida pertenencia al canal. NUNCA se confía en un channelId del cliente:
 * un canal privado no debe existir para quien no es miembro.
 */
export async function requireChannelMember(
  auth: MessagingAuthContext,
  channelId: string,
): Promise<{ channelId: string; memberRole: 'OWNER' | 'MEMBER'; kind: string }> {
  const [row] = await db
    .select({
      memberRole: imChannelMembers.role,
      kind: imChannels.kind,
    })
    .from(imChannelMembers)
    .innerJoin(imChannels, eq(imChannels.id, imChannelMembers.channelId))
    .where(
      and(
        eq(imChannelMembers.channelId, channelId),
        eq(imChannelMembers.userId, auth.userId),
        eq(imChannelMembers.tenantId, auth.tenantId),
        isNull(imChannelMembers.leftAt),
      ),
    )
    .limit(1);

  if (!row) throw new NotChannelMemberError();
  return { channelId, memberRole: row.memberRole, kind: row.kind };
}

/** Gestionar el canal: renombrar, archivar, invitar, expulsar. */
export async function requireChannelManager(
  auth: MessagingAuthContext,
  channelId: string,
): Promise<void> {
  const member = await requireChannelMember(auth, channelId);
  if (member.memberRole === 'OWNER' || auth.role === 'admin') return;
  throw new MessagingForbiddenError(auth.role, 'admin');
}

/**
 * `viewer` no publica en canales de operación, pero sí en sus DM y grupos:
 * silenciarlo del todo lo deja fuera de la coordinación sin ganar nada.
 */
export function canPostIn(role: MessagingRole, channelKind: string): boolean {
  if (role !== 'viewer') return true;
  return channelKind === 'DM' || channelKind === 'GROUP';
}
