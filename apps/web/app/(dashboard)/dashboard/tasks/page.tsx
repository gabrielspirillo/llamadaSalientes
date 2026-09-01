import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { normalizeRole } from '@/lib/tasks/auth';
import { ensureAutomationRules } from '@/lib/tasks/automation';
import { materializeRoutinesForTenant } from '@/lib/tasks/materialize';
import {
  internalUserIdFor,
  loadAutomationRules,
  loadBoardTasks,
  loadTaskMembers,
  loadTaskStats,
  loadTemplates,
} from '@/lib/tasks/queries';
import { seedSystemTemplates } from '@/lib/tasks/templates';
import { getCurrentTenant } from '@/lib/tenant';
import { and, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

/**
 * Sección Tareas.
 *
 * En la primera visita de cada clínica se auto-provisiona todo lo que hace
 * falta para que el tablero no arranque vacío: el catálogo de rutinas de
 * clínica dental, las reglas de automatización y las tareas del día. Es
 * idempotente, así que en las visitas siguientes no hace prácticamente nada.
 */
export default async function TasksPage() {
  const { tenant, userId: clerkUserId } = await getCurrentTenant();

  await seedSystemTemplates(tenant.id);
  await ensureAutomationRules(tenant.id);
  // Si el worker todavía no pasó (clínica recién activada, o redeploy), las
  // rutinas de hoy se materializan acá mismo. El dedupe evita duplicados.
  await materializeRoutinesForTenant(tenant.id).catch((err) => {
    console.warn('[tasks-page] materialize falló', (err as Error).message);
  });

  const currentUserId = await internalUserIdFor(clerkUserId);

  const [membershipRow] = currentUserId
    ? await db
        .select({ role: tenantMemberships.role })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .where(and(eq(tenantMemberships.tenantId, tenant.id), eq(users.clerkUserId, clerkUserId)))
        .limit(1)
    : [];

  const role = normalizeRole(membershipRow?.role);

  const [board, members, templates, rules] = await Promise.all([
    loadBoardTasks(tenant.id),
    loadTaskMembers(tenant.id, tenant.clerkOrganizationId),
    loadTemplates(tenant.id),
    loadAutomationRules(tenant.id),
  ]);
  const stats = await loadTaskStats(tenant.id, board);

  return (
    <TasksWorkspace
      initialTasks={board}
      initialStats={stats}
      members={members}
      templates={templates}
      rules={rules}
      currentUserId={currentUserId}
      role={role}
    />
  );
}
