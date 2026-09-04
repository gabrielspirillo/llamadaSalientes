import { DemoBanner } from '@/components/dashboard/demo-banner';
import { GlobalAnalyticsBar } from '@/components/dashboard/global-analytics-bar';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { TeamBoardCard } from '@/components/dashboard/team-board-card';
import { BoardCard, BoardColumn } from '@/components/ui/board';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Reveal } from '@/components/ui/motion';
import { formatDuration, getDashboardStats, getUpcomingAppointments } from '@/lib/data/calls-list';
import { getDemoUpcoming } from '@/lib/demo-data';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { tenant } = await getCurrentTenant();
  const demo = (await searchParams).demo === '1';
  // Las dos sólo dependen del tenant: encadenarlas sumaba un round-trip a cada
  // carga del home, y este se repite con el refresco automático.
  const [upcoming, stats] = demo
    ? [
        getDemoUpcoming(),
        {
          callsToday: 12,
          callsYesterday: 9,
          avgDurationSec: 168,
          conversionRate: 64,
          containmentRate: 82,
        },
      ]
    : await Promise.all([getUpcomingAppointments(tenant.id, 8), getDashboardStats(tenant.id)]);

  const nextNames = upcoming
    .map((u) => u.patientName ?? u.phone ?? 'Paciente')
    .filter((n): n is string => Boolean(n));

  const clinicName = tenant.name.split(/['']s|\s/)[0];

  return (
    <>
      <PageHeader
        eyebrow="Panel general"
        title={`Buenas, ${clinicName}`}
        description="Resumen en directo de tu clínica: llamadas, citas y huecos recuperados."
        icon={<Sparkles className="h-5 w-5" />}
        demoBadge={demo}
        actions={
          demo ? (
            <Button asChild variant="secondary">
              <Link href="/dashboard">Salir del ejemplo</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="secondary">
                <Link href="/dashboard?demo=1">
                  <Sparkles className="h-4 w-4" /> Ver ejemplo
                </Link>
              </Button>
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

      <GlobalAnalyticsBar tenantId={tenant.id} demo={demo} />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Reveal direction="left">
          <BoardColumn title="Hoy en la clínica" count={upcoming.length}>
            <BoardCard
              href="/dashboard/calls"
              tone="sky"
              tags={['citas', 'agenda']}
              title="Próximas citas reservadas"
              noteLabel="Siguiente:"
              note={
                upcoming[0]
                  ? `${upcoming[0].patientName ?? upcoming[0].phone ?? 'Paciente'} · ${upcoming[0].startTime.toLocaleString(
                      'es-ES',
                      {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}`
                  : 'Todavía no hay citas reservadas'
              }
              people={nextNames}
              counts={{ comments: upcoming.length }}
            />
            <BoardCard
              href="/dashboard/calls"
              tone="mint"
              tags={['llamadas', 'entrantes']}
              title="Llamadas atendidas hoy"
              noteLabel="Ayer:"
              note={`${stats.callsYesterday} llamadas · duración media ${formatDuration(stats.avgDurationSec)}`}
              progress={stats.conversionRate}
              progressLabel="Acaban en cita"
              counts={{ comments: stats.callsToday }}
            />
            <BoardCard
              href="/dashboard/tasks"
              tone="coral"
              tags={['tareas', 'equipo']}
              title="Tareas del equipo"
              noteLabel="Para hoy:"
              note="Llamadas por devolver, seguimientos y recados. Lo urgente, arriba."
            />
          </BoardColumn>
        </Reveal>

        <Reveal>
          <BoardColumn title="Canales de contacto">
            <BoardCard
              href="/dashboard/whatsapp"
              tone="grape"
              tags={['whatsapp', 'bandeja']}
              title="Conversaciones de WhatsApp"
              noteLabel="Bandeja:"
              note="Lo que el asistente responde y lo que pasa a una persona."
            />
            <BoardCard
              href="/dashboard/outbound"
              tone="blossom"
              tags={['salientes', 'campañas']}
              title="Campañas de llamadas salientes"
              noteLabel="Para qué:"
              note="Recordar citas, recuperar pacientes y avisar de huecos libres."
            />
            <BoardCard
              href="/dashboard/reminders"
              tone="honey"
              tags={['recordatorios']}
              title="Recordatorios de citas"
              noteLabel="Objetivo:"
              note="Menos citas no asistidas avisando por WhatsApp y por voz."
            />
            <BoardCard
              href="/dashboard/messages"
              tone="sky"
              tags={['equipo', 'chat']}
              title="Mensajes del equipo"
              noteLabel="Interno:"
              note="El chat de la clínica y los avisos que levanta el asistente."
            />
          </BoardColumn>
        </Reveal>

        <Reveal direction="right">
          <BoardColumn title="Tu clínica">
            <TeamBoardCard />
            <BoardCard
              href="/dashboard/treatments"
              tone="grape"
              tags={['tratamientos', 'catálogo']}
              title="Tratamientos que ofrece el asistente"
              noteLabel="Importante:"
              note="Si un tratamiento no está aquí, el asistente no lo ofrece."
            />
            <BoardCard
              href="/dashboard/analytics"
              tone="mint"
              tags={['métricas']}
              title="Cómo va la clínica"
              noteLabel="Incluye:"
              note="Llamadas, citas no asistidas e ingresos recuperados."
              progress={stats.containmentRate}
              progressLabel="Resueltas sin persona"
            />
          </BoardColumn>
        </Reveal>
      </div>
    </>
  );
}
