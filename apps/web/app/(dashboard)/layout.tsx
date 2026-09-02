import { DashboardOverlays } from '@/components/dashboard/dashboard-overlays';
import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardTopbar } from '@/components/dashboard/topbar';
import { MessagingProvider } from '@/components/messaging/MessagingProvider';
import { unreadSummary } from '@/lib/messaging/queries';
import { DEFAULT_ENABLED_MODULES, type EnabledModules } from '@/lib/modules';
import { countActionableTasks, internalUserIdFor } from '@/lib/tasks/queries';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // Sin organización activa → llevamos a onboarding (crea o elige clínica).
  if (!orgId) {
    redirect('/onboarding');
  }

  // Tenant puede no existir si el webhook de Clerk todavía no llegó (1-2s).
  // En ese caso renderizamos con módulos OFF — al refrescar el tenant ya estará.
  const tenantCtx = await getCurrentTenantOrNull();

  // Clínica nueva que todavía no completó el onboarding → al wizard. Solo aplica
  // a clínicas en estado 'onboarding' (las nuevas) y SOLO al admin/dueño: un
  // trabajador que se une por invitación no debe pasar por el onboarding.
  // Las clínicas existentes (trial/active) no se tocan.
  if (
    tenantCtx?.tenant.status === 'onboarding' &&
    orgRole === 'org:admin' &&
    !tenantCtx.impersonating
  ) {
    redirect('/onboarding/setup');
  }

  const enabledModules: EnabledModules =
    (tenantCtx?.tenant.enabledModules as EnabledModules | null) ?? DEFAULT_ENABLED_MODULES;

  // Futura (super-admin) ve las conexiones técnicas; la clínica ve solo lectura.
  const isSuperAdmin = tenantCtx?.isSuperAdmin ?? false;

  // Badge de Tareas: lo mío vencido o para hoy. Una query barata por render;
  // si falla (tenant recién creado, DB lenta) el sidebar se dibuja sin badge.
  let tasksBadge = 0;
  let messagesBadge = 0;
  if (tenantCtx) {
    const internalUserId = await internalUserIdFor(userId).catch(() => null);

    if (internalUserId) {
      // Los dos badges sólo dependen del internalUserId, así que van en
      // paralelo: encadenados sumaban un round-trip a CADA navegación del
      // panel. Si las tablas im_ todavía no existen (migración 0019 sin
      // aplicar) el panel entero tiene que seguir dibujándose, por eso los
      // fallos se tragan y el badge queda en 0.
      const [tasks, messages] = await Promise.all([
        countActionableTasks(tenantCtx.tenant.id, internalUserId).catch(() => 0),
        unreadSummary(tenantCtx.tenant.id, internalUserId)
          .then((s) => s.totalUnread)
          .catch(() => 0),
      ]);
      tasksBadge = tasks;
      messagesBadge = messages;
    }
  }

  return (
    // El provider envuelve todo el panel: es el dueño único del EventSource de
    // Mensajes y lo consumen el sidebar (badge), la campana y el dock.
    <MessagingProvider>
      <div data-instant-reveal className="aurora-canvas flex min-h-screen text-zinc-900">
        <DashboardSidebar
          enabledModules={enabledModules}
          isSuperAdmin={isSuperAdmin}
          tasksBadge={tasksBadge}
          messagesBadge={messagesBadge}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {tenantCtx?.impersonating && <ImpersonationBanner clinicName={tenantCtx.tenant.name} />}
          <DashboardTopbar
            enabledModules={enabledModules}
            isSuperAdmin={isSuperAdmin}
            impersonatingClinic={tenantCtx?.impersonating ? tenantCtx.tenant.name : undefined}
            tasksBadge={tasksBadge}
            messagesBadge={messagesBadge}
          />
          {/* La key por ruta re-dispara la animación de entrada en cada navegación. */}
          <main className="enter-page flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-9">
            <div className="mx-auto w-full max-w-[1480px]">{children}</div>
          </main>
        </div>
        <DashboardOverlays tourAutoStart={!isSuperAdmin && !tenantCtx?.impersonating} />
      </div>
    </MessagingProvider>
  );
}
