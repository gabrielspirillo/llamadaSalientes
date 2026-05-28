import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardTopbar } from '@/components/dashboard/topbar';
import { DEFAULT_ENABLED_MODULES, type EnabledModules } from '@/lib/modules';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await auth();

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
  const enabledModules: EnabledModules =
    (tenantCtx?.tenant.enabledModules as EnabledModules | null) ?? DEFAULT_ENABLED_MODULES;

  return (
    <div className="flex min-h-screen bg-white text-zinc-900">
      <DashboardSidebar enabledModules={enabledModules} />
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardTopbar enabledModules={enabledModules} />
        <main className="flex-1 px-4 sm:px-6 lg:px-10 py-5 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
