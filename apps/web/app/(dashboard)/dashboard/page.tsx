import { DemoBanner } from '@/components/dashboard/demo-banner';
import { DemoSwitch, DemoToggle } from '@/components/dashboard/demo-switch';
import { GlobalAnalyticsBar } from '@/components/dashboard/global-analytics-bar';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { TodayBoardCard } from '@/components/dashboard/today-board';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Reveal } from '@/components/ui/motion';
import { Avatar } from '@/components/ui/stat';
import { resolveTimezone, tenantHasAgenda } from '@/lib/agenda/queries';
import { SOURCE_LABELS } from '@/lib/agenda/shared';
import { getDemoTodayBoard, getTodayBoard } from '@/lib/data/analytics/today-board';
import { getUpcomingAppointments } from '@/lib/data/calls-list';
import { getDemoUpcoming } from '@/lib/demo-data';
import { getCurrentTenant } from '@/lib/tenant';
import { currentUser } from '@clerk/nextjs/server';
import { ArrowRight, Bot, CalendarClock, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { tenant } = await getCurrentTenant();
  const demo = (await searchParams).demo === '1';
  // Las dos vistas se renderizan en el servidor; la de muestra es fija y no
  // toca la base. El cambio entre una y otra es instantáneo, en el cliente.
  return (
    <DemoSwitch
      initialDemo={demo}
      real={<DashboardBody tenant={tenant} demo={false} />}
      demo={<DashboardBody tenant={tenant} demo />}
    />
  );
}

async function DashboardBody({
  tenant,
  demo,
}: {
  tenant: Awaited<ReturnType<typeof getCurrentTenant>>['tenant'];
  demo: boolean;
}) {
  // El saludo con nombre y hora vivía en el topbar, donde gastaba sitio en
  // todas las pantallas de trabajo. Aquí es el único lugar donde aporta.
  const [user, timezone] = await Promise.all([
    currentUser().catch(() => null),
    resolveTimezone(tenant.id, null).catch(() => 'Europe/Madrid'),
  ]);
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone })
      .formatToParts(new Date())
      .find((p) => p.type === 'hour')?.value ?? '12',
  );
  const saludo =
    hour < 6 || hour >= 20 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : 'Buenas tardes';
  const firstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? '';
  // Todo lo que no depende de otra cosa va en la misma tanda: el home se
  // vuelve a ejecutar con cada refresco automático.
  const hasAgenda = demo ? true : await tenantHasAgenda(tenant.id).catch(() => false);
  const [upcoming, board] = demo
    ? [getDemoUpcoming(), getDemoTodayBoard(timezone)]
    : await Promise.all([
        getUpcomingAppointments(tenant.id, 8),
        hasAgenda ? getTodayBoard(tenant.id, timezone).catch(() => null) : null,
      ]);

  const clinicName = tenant.name.split(/['']s|\s/)[0];

  return (
    <>
      <PageHeader
        eyebrow="Panel general"
        title={`${saludo}, ${firstName || clinicName}`}
        description={`Resumen en directo de ${tenant.name}: llamadas, citas y huecos recuperados.`}
        icon={<Sparkles className="h-5 w-5" />}
        demoBadge={demo}
        actions={
          demo ? (
            <DemoToggle to="real" />
          ) : (
            <>
              <DemoToggle to="demo" />
              <Button asChild>
                <Link href="/dashboard/agent">
                  Probar el asistente
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </Button>
            </>
          )
        }
      />

      {/* Sin UI: refresca server components cada 30s mientras la pestaña está visible.
          En demo lo desactivamos: los datos son fijos y no queremos re-fetchs. */}
      {!demo && (
        <div className="hidden">
          {/* Cada tick es un router.refresh() completo: re-ejecuta el layout
              (auth + los dos badges) y la página entera. A 30 s era un
              round-trip de servidor cada media vuelta de reloj mientras alguien
              simplemente miraba la pantalla, y el contador de Mensajes ya llega
              en vivo por SSE. */}
          <RealtimeRefresh intervalMs={120_000} />
        </div>
      )}

      {demo && <DemoBanner />}

      {board && <TodayBoardCard board={board} demo={demo} />}

      <GlobalAnalyticsBar tenantId={tenant.id} demo={demo} board={board} />

      <div className="rise-stagger grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        {/* Próximas citas — cuáles son, no solo cuántas */}
        <Reveal className="[--i:0]">
          <Card className="h-full overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-(--color-border-subtle) px-5 py-3.5">
              <h3 className="inline-flex items-center gap-2 text-[14px] font-bold tracking-tight text-zinc-800">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-brand-100 text-brand-700">
                  <CalendarClock className="h-4 w-4" />
                </span>
                Próximas citas
              </h3>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/agenda">
                  Ver agenda
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
            {upcoming.length === 0 ? (
              <p className="px-5 py-6 text-[14px] text-zinc-500">
                Todavía no hay citas reservadas. Cuando el asistente dé una cita, aparecerá aquí.
              </p>
            ) : (
              <ul className="rise-stagger divide-y divide-(--color-border-subtle)">
                {upcoming.slice(0, 7).map((a, i) => (
                  <li
                    key={a.callId}
                    style={{ ['--i' as string]: i }}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50"
                  >
                    <Avatar name={a.patientName ?? a.phone ?? 'Paciente'} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-zinc-800">
                        {a.patientName ?? a.phone ?? 'Paciente'}
                      </span>
                      {a.treatmentName && (
                        <span className="block truncate text-[13px] text-zinc-500">
                          {a.treatmentName}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-semibold text-zinc-700">
                        {a.startTime.toLocaleDateString('es-ES', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          timeZone: timezone,
                        })}
                      </span>
                      <span className="block text-[13px] tabular-nums text-brand-600">
                        {a.startTime.toLocaleTimeString('es-ES', {
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: timezone,
                        })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>

        {/* Lo que hizo el asistente sin que nadie tocara nada */}
        <Reveal className="[--i:1]">
          <Card className="h-full overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-(--color-border-subtle) px-5 py-3.5">
              <h3 className="inline-flex items-center gap-2 text-[14px] font-bold tracking-tight text-zinc-800">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-sky-100 text-sky-700">
                  <Bot className="h-4 w-4" />
                </span>
                Lo que hizo el asistente
              </h3>
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/agent">
                  Probarlo
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
            {!board || board.assistant.length === 0 ? (
              <p className="px-5 py-6 text-[14px] text-zinc-500">
                Aquí saldrán las citas que el asistente reserve por WhatsApp o por teléfono.
              </p>
            ) : (
              <ul className="rise-stagger divide-y divide-(--color-border-subtle)">
                {board.assistant.map((a, i) => (
                  <li
                    key={a.id}
                    style={{ ['--i' as string]: i }}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-zinc-800">
                        Cita para {a.patientName}
                      </span>
                      <span className="block truncate text-[12.5px] text-zinc-500">
                        {SOURCE_LABELS[a.source]} ·{' '}
                        {a.startsAt.toLocaleString('es-ES', {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                          timeZone: timezone,
                        })}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-zinc-400">
                      {relativeAgo(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>
      </div>
    </>
  );
}

function relativeAgo(d: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}
