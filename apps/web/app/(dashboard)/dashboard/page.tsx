import { GlobalAnalyticsBar } from '@/components/dashboard/global-analytics-bar';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getUpcomingAppointments } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  Phone,
  PhoneOutgoing,
  Stethoscope,
  User,
} from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview() {
  const { tenant } = await getCurrentTenant();
  const upcoming = await getUpcomingAppointments(tenant.id, 8);

  return (
    <>
      <PageHeader
        title={`Buenas, ${tenant.name.split(/['']s|\s/)[0]}`}
        description="Resumen en tiempo real de tu clínica."
        actions={
          <Button asChild>
            <Link href="/dashboard/agent">
              Probar agente <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />
      {/* Sin UI: refresca server components cada 30s mientras la pestaña está visible */}
      <div className="hidden">
        <RealtimeRefresh intervalMs={30_000} />
      </div>

      <GlobalAnalyticsBar tenantId={tenant.id} />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-6 pb-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-violet-600" />
                Próximas citas
              </h3>
              <p className="text-sm text-zinc-500 mt-0.5">Agendadas y confirmadas</p>
            </div>
            <Badge tone="violet">{upcoming.length}</Badge>
          </div>
          <div className="border-t border-zinc-100">
            {upcoming.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-zinc-700">Sin próximas citas</p>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Cuando el agente agende una cita, aparece acá.
                </p>
              </div>
            ) : (
              <ul>
                {upcoming.map((u) => (
                  <li
                    key={u.callId}
                    className="flex items-center gap-3 px-6 py-3.5 border-b border-zinc-50 last:border-b-0"
                  >
                    <div className="h-9 w-9 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {u.patientName ?? u.phone ?? 'Paciente'}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {u.treatmentName ?? 'Cita'} ·{' '}
                        {u.startTime.toLocaleString('es-ES', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <div className="p-6">
            <h3 className="text-base font-semibold tracking-tight mb-3">Accesos rápidos</h3>
            <div className="space-y-2">
              <QuickAction
                href="/dashboard/agent"
                icon={<Bot className="h-4 w-4" />}
                label="Probar agente"
              />
              <QuickAction
                href="/dashboard/treatments"
                icon={<Stethoscope className="h-4 w-4" />}
                label="Editar tratamientos"
              />
              <QuickAction
                href="/dashboard/outbound"
                icon={<PhoneOutgoing className="h-4 w-4" />}
                label="Crear campaña saliente"
              />
              <QuickAction
                href="/dashboard/analytics"
                icon={<BarChart3 className="h-4 w-4" />}
                label="Ver analytics por módulo"
              />
              <QuickAction
                href="/dashboard/settings/telephony"
                icon={<Phone className="h-4 w-4" />}
                label="Configurar telefonía"
              />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-zinc-200/70 px-3.5 py-2.5 text-sm hover:border-zinc-300 hover:bg-zinc-50/60 transition-all"
    >
      <span className="text-zinc-500">{icon}</span>
      <span>{label}</span>
      <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-400" />
    </Link>
  );
}
