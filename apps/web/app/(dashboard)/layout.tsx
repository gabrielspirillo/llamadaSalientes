import { ImpersonationBanner } from '@/components/dashboard/impersonation-banner';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardTopbar } from '@/components/dashboard/topbar';
import { WelcomeTour } from '@/components/dashboard/welcome-tour';
import { DEFAULT_ENABLED_MODULES, type EnabledModules } from '@/lib/modules';
import { getTenantTimezone } from '@/lib/tasks/materialize';
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
  if (tenantCtx) {
    try {
      const internalUserId = await internalUserIdFor(userId);
      tasksBadge = await countActionableTasks(
        tenantCtx.tenant.id,
        internalUserId,
        new Date(),
        await getTenantTimezone(tenantCtx.tenant.id),
      );
    } catch {
      tasksBadge = 0;
    }
  }

  return (
    <div className="aurora-canvas flex min-h-screen text-zinc-900">
      <DashboardSidebar
        enabledModules={enabledModules}
        isSuperAdmin={isSuperAdmin}
        tasksBadge={tasksBadge}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {tenantCtx?.impersonating && <ImpersonationBanner clinicName={tenantCtx.tenant.name} />}
        <DashboardTopbar
          enabledModules={enabledModules}
          isSuperAdmin={isSuperAdmin}
          impersonatingClinic={tenantCtx?.impersonating ? tenantCtx.tenant.name : undefined}
          tasksBadge={tasksBadge}
        />
        {/* La key por ruta re-dispara la animación de entrada en cada navegación. */}
        <main className="enter-page flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-9">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
      <WelcomeTour autoStart={!isSuperAdmin && !tenantCtx?.impersonating} />
    </div>
  );
}
