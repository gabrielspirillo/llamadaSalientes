import { PageHeader } from '@/components/dashboard/page-header';
import { TasksWorkspace } from '@/components/tasks/TasksWorkspace';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { resolveTenantRole } from '@/lib/auth/tenant-role';
import { getTenantTimezone, materializeRoutinesForTenant } from '@/lib/tasks/materialize';
import {
  loadAutomationRules,
  loadBoardTasks,
  loadTaskMembers,
  loadTaskStats,
  loadTemplates,
} from '@/lib/tasks/queries';
import { getCurrentTenant } from '@/lib/tenant';
import { ClipboardCheck, DatabaseZap } from 'lucide-react';
import { after } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Sección Tareas.
 *
 * Sin rutinas ni automatizaciones de serie: cada clínica crea las suyas.
 */
export default async function TasksPage() {
  const { tenant } = await getCurrentTenant();

  try {
    // Ya no se siembra nada: cada clínica crea sus rutinas y automatizaciones
    // (migración 0074). Lo único que queda es materializar las rutinas propias
    // que toquen hoy, fuera del camino del render (el cron también lo hace).
    after(() =>
      materializeRoutinesForTenant(tenant.id).catch((err) => {
        console.warn('[tasks-page] materialize falló', (err as Error).message);
      }),
    );

    // Rol y `users.id` interno de una vez: Futura es admin en cualquier
    // clínica que gestione; el resto, lo que diga su membresía. Sin membresía
    // se pinta la UI de operador (los gates del servidor son los que deciden).
    const access = await resolveTenantRole();
    const currentUserId = access.internalUserId;
    const role = access.role ?? 'operator';

    // loadTaskStats necesita el tablero, pero el resto no: va fuera del
    // Promise.all. La timezone SÍ entra en él —sólo depende del tenant— porque
    // esperarla después sumaba otro round-trip en serie.
    const [board, members, templates, rules, timezone] = await Promise.all([
      loadBoardTasks(tenant.id),
      loadTaskMembers(tenant.id, tenant.clerkOrganizationId),
      loadTemplates(tenant.id),
      loadAutomationRules(tenant.id),
      getTenantTimezone(tenant.id),
    ]);
    const stats = await loadTaskStats(tenant.id, board, new Date(), timezone);

    return (
      <TasksWorkspace
        initialTasks={board}
        initialStats={stats}
        members={members}
        templates={templates}
        rules={rules}
        currentUserId={currentUserId}
        role={role}
        timezone={await getTenantTimezone(tenant.id).catch(() => null)}
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
