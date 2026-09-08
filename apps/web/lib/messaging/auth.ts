import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';

import { type TenantRole, resolveTenantRole, roleSatisfies } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db/client';
import { imChannelMembers, imChannels } from '@/lib/db/schema';

/**
 * Gate de rol del módulo Mensajes. Reutiliza `resolveTenantRole()`, la misma
 * fuente que Tareas, para no tener dos tablas de permisos.
 *
 * Criterio: `viewer` lee canales públicos y escribe en sus DM (es el perfil de
 * quien mira números sin operar); `operator` escribe en canales y convierte
 * mensajes en tareas; `admin` crea canales públicos, archiva y expulsa.
 */
export type MessagingRole = TenantRole;

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
  const ctx = await resolveTenantRole();

  if (ctx.role === null) throw new MessagingForbiddenError('viewer', min);
  if (!roleSatisfies(ctx.role, min)) throw new MessagingForbiddenError(ctx.role, min);

  return {
    tenantId: ctx.tenantId,
    clerkOrganizationId: ctx.clerkOrganizationId,
    userId: ctx.internalUserId,
    clerkUserId: ctx.clerkUserId,
    role: ctx.role,
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
