import { PageHeader } from '@/components/dashboard/page-header';
import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { db } from '@/lib/db/client';
import { tenantMemberships, users } from '@/lib/db/schema';
import { normalizeRole } from '@/lib/tasks/auth';
import { ensureAutomationRules } from '@/lib/tasks/automation';
import { getTenantTimezone, materializeRoutinesForTenant } from '@/lib/tasks/materialize';
import {
  internalUserIdFor,
  loadAutomationRules,
  loadBoardTasks,
  loadTaskMembers,
  loadTaskStats,
  loadTemplates,
} from '@/lib/tasks/queries';
import { hasSystemTemplates, seedSystemTemplates } from '@/lib/tasks/templates';
import { getCurrentTenant } from '@/lib/tenant';
import { and, eq } from 'drizzle-orm';
import { ClipboardCheck, DatabaseZap } from 'lucide-react';
import { after } from 'next/server';

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

  try {
    // La auto-provisión bloquea el render SÓLO la primera vez, que es cuando
    // hace falta para que el tablero no arranque vacío. Después se manda al
    // background con `after()`: son tres escrituras + una materialización que
    // no aportan nada al render y que sumaban cientos de ms a cada visita.
    // El cron `task-routines-tick` cubre igual el caso del worker.
    const provisioned = await hasSystemTemplates(tenant.id).catch(() => false);
    const provision = async () => {
      await seedSystemTemplates(tenant.id);
      await ensureAutomationRules(tenant.id);
      await materializeRoutinesForTenant(tenant.id).catch((err) => {
        console.warn('[tasks-page] materialize falló', (err as Error).message);
      });
    };
    if (provisioned) {
      after(() => provision().catch(() => undefined));
    } else {
      await provision();
    }

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

    // loadTaskStats necesita el tablero, pero el resto no: iba fuera del
    // Promise.all y agregaba un round-trip de más.
    const [board, members, templates, rules] = await Promise.all([
      loadBoardTasks(tenant.id),
      loadTaskMembers(tenant.id, tenant.clerkOrganizationId),
      loadTemplates(tenant.id),
      loadAutomationRules(tenant.id),
    ]);
    const stats = await loadTaskStats(
      tenant.id,
      board,
      new Date(),
      await getTenantTimezone(tenant.id),
    );

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
  } catch (err) {
    // El caso real: la migración 0018 todavía no se aplicó en esta base, así
    // que las tablas no existen. Antes esto tiraba una excepción de servidor
    // y el panel entero mostraba "Application error". Mejor decir qué pasa.
    if (isMissingTablesError(err)) return <PendingMigration />;
    throw err;
  }
}

/** Postgres 42P01 = undefined_table. Es la firma de "falta la migración". */
function isMissingTablesError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === '42P01') return true;
  const message = (err as Error | null)?.message ?? '';
  return /relation ".*" does not exist/i.test(message);
}

function PendingMigration() {
  return (
    <>
      <PageHeader
        eyebrow="Operativa diaria"
        title="Tareas"
        description="El tablero del equipo: lo que hay que hacer hoy con los pacientes y con la clínica."
        icon={<ClipboardCheck className="h-5 w-5" />}
      />
      <Card>
        <EmptyState
          icon={<DatabaseZap className="h-6 w-6" />}
          title="Estamos preparando esta sección"
          description="Tareas todavía se está activando para tu clínica. Suele tardar unos minutos: vuelve a cargar la página en un rato. Si sigue igual mañana, avísanos y lo revisamos."
        />
      </Card>
    </>
  );
}
