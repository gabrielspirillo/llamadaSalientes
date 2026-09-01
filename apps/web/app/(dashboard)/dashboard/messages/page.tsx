import { PageHeader } from '@/components/dashboard/page-header';
import { MessagesWorkspace } from '@/components/messaging/MessagesWorkspace';
import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { internalUserIdFor, loadRail } from '@/lib/messaging/queries';
import { seedMessagingForTenant } from '@/lib/messaging/seed';
import type { ImRailDTO } from '@/lib/messaging/types';
import { normalizeRole } from '@/lib/tasks/auth';
import { getCurrentTenant } from '@/lib/tenant';
import { and, eq } from 'drizzle-orm';
import { MessageSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Mensajería interna del equipo.
 *
 * En la primera visita de cada clínica se siembran los canales base (#general,
 * #agenda, #urgencias) y se suma a todo el mundo. Es idempotente, igual que la
 * auto-provisión de Tareas, así que en las visitas siguientes no hace nada.
 * Si falla —por ejemplo porque la migración todavía no corrió— la página se
 * dibuja igual con el rail vacío en vez de reventar.
 */
export default async function MessagesPage() {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  await seedMessagingForTenant(tenant.id, tenant.clerkOrganizationId).catch((err) => {
    console.warn('[messages-page] seed falló', (err as Error).message);
  });

  let currentUserId: string | null = null;
  try {
    currentUserId = await internalUserIdFor(clerkUserId);
  } catch {
    currentUserId = null;
  }

  const emptyRail: ImRailDTO = {
    channels: [],
    people: [],
    presence: [],
    totalUnread: 0,
    totalMentions: 0,
    me: null,
  };

  let rail: ImRailDTO = emptyRail;
  if (currentUserId) {
    try {
      rail = await loadRail(tenant.id, currentUserId, tenant.clerkOrganizationId);
    } catch (err) {
      console.warn('[messages-page] loadRail falló', (err as Error).message);
    }
  }

  // Mismo criterio de roles que Tareas: `viewer` mira, el resto escribe.
  const [membershipRow] = await db
    .select({ role: tenantMemberships.role })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)))
    .limit(1);

  const role = normalizeRole(membershipRow?.role);

  return (
    <>
      <PageHeader
        eyebrow="Equipo"
        title="Mensajes"
        icon={<MessageSquare className="h-5 w-5" />}
        description="Canales del equipo, avisos del sistema y el hilo de cada paciente, en un solo sitio."
      />
      <MessagesWorkspace
        initialRail={rail}
        currentUserId={currentUserId}
        canWrite={role !== 'viewer'}
        isAdmin={role === 'admin'}
      />
    </>
  );
}
