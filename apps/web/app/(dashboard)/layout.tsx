import { DashboardOverlays } from '@/components/dashboard/dashboard-overlays';
import { NavProgressBar } from '@/components/dashboard/nav-progress';
import { ScrollReset } from '@/components/dashboard/scroll-reset';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardTopbar } from '@/components/dashboard/topbar';
import { MessagingProvider } from '@/components/messaging/MessagingProvider';
import {
  findProfessionalForClerkUser,
  isAgendaOnly,
  isAgendaOnlyAllowedPath,
} from '@/lib/agenda/access';
import type { Branding } from '@/lib/branding';
import { unreadSummary } from '@/lib/messaging/queries';
import { DEFAULT_ENABLED_MODULES, type EnabledModules } from '@/lib/modules';
import { normalizeRole } from '@/lib/tasks/auth';
import { getTenantTimezone } from '@/lib/tasks/materialize';
import { countActionableTasks, internalUserIdFor } from '@/lib/tasks/queries';
import { getCurrentTenantOrNull } from '@/lib/tenant';
import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
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

  // ⚠️ Este layout envuelve TODO el panel: sidebar, topbar y la página. Hasta
  // que termina, el navegador no recibe nada nuevo — ni siquiera el
  // `loading.tsx` de la página destino. Cada `await` encadenado aquí es tiempo
  // en el que la pantalla se queda idéntica y la app se lee como colgada. Y no
  // se paga sólo al navegar: cada `router.refresh()` (el inbox de WhatsApp lo
  // dispara con cada mensaje) vuelve a ejecutarlo entero.
  //
  // Por eso todo lo que no dependa de otra cosa arranca a la vez. El
  // `users.id` interno sólo necesita el usuario de Clerk, que ya tenemos, así
  // que su consulta sale AHORA y viaja en paralelo con la del tenant en vez de
  // esperar su turno.
  const internalUserIdPromise = internalUserIdFor(userId).catch(() => null);

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

  // Profesional con acceso restringido: el panel se le queda en su agenda.
  // El enlace se mira SIEMPRE en el servidor y la redirección es de servidor;
  // esconder ítems del menú no protegería nada (las escrituras del resto del
  // panel las corta `requireTaskRole`).
  //
  // La ficha de profesional y los dos badges sólo necesitan el tenant y el
  // `users.id`, que ya están: van los tres en una única tanda. Encadenados eran
  // tres round-trips a Postgres, uno detrás de otro, en el camino crítico de
  // CADA página del panel.
  let agendaOnly = false;
  let tasksBadge = 0;
  let messagesBadge = 0;

  if (tenantCtx) {
    const internalUserId = await internalUserIdPromise;
    const tenantId = tenantCtx.tenant.id;

    const [professional, tasks, messages] = await Promise.all([
      findProfessionalForClerkUser(tenantId, userId).catch(() => null),
      // Badge de Tareas: lo mío vencido o para hoy. Si falla (tenant recién
      // creado, DB lenta) el sidebar se dibuja sin badge.
      internalUserId ? countActionableTasks(tenantId, internalUserId).catch(() => 0) : 0,
      // Si las tablas `im_` todavía no existen (migración 0019 sin aplicar) el
      // panel entero tiene que seguir dibujándose, por eso se traga el fallo.
      internalUserId
        ? unreadSummary(tenantId, internalUserId)
            .then((s) => s.totalUnread)
            .catch(() => 0)
        : 0,
    ]);

    tasksBadge = tasks;
    messagesBadge = messages;

    agendaOnly = isAgendaOnly(professional, {
      role: normalizeRole(orgRole),
      isSuperAdmin: tenantCtx.isSuperAdmin,
    });
    if (agendaOnly) {
      const pathname = (await headers()).get('x-pathname') ?? '/dashboard';
      if (!isAgendaOnlyAllowedPath(pathname)) redirect('/dashboard/agenda');
    }
  }

  const enabledModules: EnabledModules =
    (tenantCtx?.tenant.enabledModules as EnabledModules | null) ?? DEFAULT_ENABLED_MODULES;

  // Futura (super-admin) ve las conexiones técnicas; la clínica ve solo lectura.
  const isSuperAdmin = tenantCtx?.isSuperAdmin ?? false;

  // Marca del panel. Si la clínica tiene logo propio (se lo pone Futura desde
  // su panel) manda el suyo; si no, se dibuja la marca FUTURA de siempre.
  // Cuando Futura está gestionando una clínica, `tenant` ya es esa clínica: se
  // ve su marca, que es justo lo que la clínica ve.
  const branding: Branding = {
    name: tenantCtx?.tenant.name ?? 'FUTURA',
    logoUrl: tenantCtx?.tenant.logoUrl ?? null,
  };

  return (
    // El provider envuelve todo el panel: es el dueño único del EventSource de
    // Mensajes y lo consumen el sidebar (badge), la campana y el dock.
    <MessagingProvider>
      <ScrollReset />
      {/* Señal global de "estoy yendo a otra página". El panel es todo
          `force-dynamic`: sin esto, entre el clic y el primer byte del servidor
          la pantalla se quedaba idéntica y parecía colgada. */}
      <NavProgressBar />
      <div data-instant-reveal className="aurora-canvas flex min-h-screen text-zinc-900">
        <DashboardSidebar
          enabledModules={enabledModules}
          isSuperAdmin={isSuperAdmin}
          branding={branding}
          tasksBadge={tasksBadge}
          messagesBadge={messagesBadge}
          agendaOnly={agendaOnly}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <DashboardTopbar
            enabledModules={enabledModules}
            isSuperAdmin={isSuperAdmin}
            branding={branding}
            impersonatingClinic={tenantCtx?.impersonating ? tenantCtx.tenant.name : undefined}
            tasksBadge={tasksBadge}
            messagesBadge={messagesBadge}
            agendaOnly={agendaOnly}
          />
          {/* La key por ruta re-dispara la animación de entrada en cada navegación. */}
          <main className="enter-page flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-9">
            <div className="mx-auto w-full max-w-[1480px]">{children}</div>
          </main>
        </div>
        <DashboardOverlays tourAutoStart={!isSuperAdmin && !tenantCtx?.impersonating} />
      </div>
    </MessagingProvider>
  );
}
