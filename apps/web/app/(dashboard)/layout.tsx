import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardTopbar } from '@/components/dashboard/topbar';
import { WelcomeTour } from '@/components/dashboard/welcome-tour';
import { MessagingProvider } from '@/components/messaging/MessagingProvider';
import { MessagesDock } from '@/components/messaging/dock/MessagesDock';
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
    let internalUserId: string | null = null;
    try {
      internalUserId = await internalUserIdFor(userId);
      tasksBadge = await countActionableTasks(tenantCtx.tenant.id, internalUserId);
    } catch {
      tasksBadge = 0;
    }

    // Badge de Mensajes: no leídos míos. Si las tablas im_ todavía no existen
    // (migración 0019 sin aplicar) el panel entero tiene que seguir dibujándose,
    // así que el fallo se traga acá y el badge queda en 0.
    if (internalUserId) {
      try {
        const summary = await unreadSummary(tenantCtx.tenant.id, internalUserId);
        messagesBadge = summary.totalUnread;
      } catch {
        messagesBadge = 0;
      }
    }
  }

  return (
    // El provider envuelve todo el panel: es el dueño único del EventSource de
    // Mensajes y lo consumen el sidebar (badge), la campana y el dock.
    <MessagingProvider>
      <div className="aurora-canvas flex min-h-screen text-zinc-900">
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
        <WelcomeTour autoStart={!isSuperAdmin && !tenantCtx?.impersonating} />
        <MessagesDock />
      </div>
    </MessagingProvider>
  );
}
