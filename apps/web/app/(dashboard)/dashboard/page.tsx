import { BackfillButton } from '@/components/dashboard/backfill-button';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { Badge } from '@/components/ui/badge';
// RealtimeRefresh sigue corriendo en background — el toggle UI se ocultó.
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  countCallsPendingIntent,
  formatDuration,
  formatRelativeTime,
  getDashboardStats,
  getMotivoBreakdown,
  getUpcomingAppointments,
  listCalls,
} from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Calendar,
  Clock,
  PhoneCall,
  Stethoscope,
  TrendingUp,
  User,
} from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview() {
  const { tenant } = await getCurrentTenant();
  const [stats, recentCalls, upcoming, motivos, pendingIntent] = await Promise.all([
    getDashboardStats(tenant.id),
    listCalls(tenant.id, 6),
    getUpcomingAppointments(tenant.id, 5),
    getMotivoBreakdown(tenant.id),
    countCallsPendingIntent(tenant.id),
  ]);
  const display = {
    callsToday: stats.callsToday,
    callsTodayDelta: `${stats.callsToday - stats.callsYesterday >= 0 ? '+' : ''}${stats.callsToday - stats.callsYesterday}`,
    aht: formatDuration(stats.avgDurationSec),
    ahtDelta: '—',
    conversionRate: stats.conversionRate,
    conversionDelta: '—',
    containmentRate: stats.containmentRate,
    containmentDelta: '—',
  };
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

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Llamadas hoy"
          value={String(display.callsToday)}
          delta={display.callsTodayDelta}
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <StatCard
          label="Tiempo promedio"
          value={display.aht}
          delta={display.ahtDelta}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Conversión a cita"
          value={`${display.conversionRate}%`}
          delta={display.conversionDelta}
          icon={<Calendar className="h-4 w-4" />}
        />
        <StatCard
          label="Resueltas por IA"
          value={`${display.containmentRate}%`}
          delta={display.containmentDelta}
          icon={<Bot className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent calls */}
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-6 pb-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Últimas llamadas</h3>
              <p className="text-sm text-zinc-500 mt-0.5">Actualizado en tiempo real</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/calls">
                Ver todas <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="border-t border-zinc-100">
            {recentCalls.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-medium text-zinc-700">Aún no hay llamadas</p>
                <p className="text-xs text-zinc-500 mt-1.5">
                  Probá el agente desde el dashboard o llamá al número configurado.
                </p>
                <Button asChild size="sm" className="mt-4">
                  <Link href="/dashboard/agent">Probar agente ahora</Link>
                </Button>
              </div>
            ) : (
              recentCalls.map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/calls/${c.id}`}
                  className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-zinc-50/60 transition-colors border-b border-zinc-50 last:border-b-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        c.sentiment === 'positivo'
                          ? 'bg-emerald-500'
                          : c.sentiment === 'negativo'
                            ? 'bg-red-500'
                            : 'bg-zinc-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.fromNumber ?? 'Llamada anónima'}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {c.summary ?? 'Sin resumen aún · ' + formatRelativeTime(c.startedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <IntentBadge intent={c.intent ?? 'otro'} />
                    <span className="text-xs text-zinc-400 tabular-nums w-16 text-right">
                      {formatDuration(c.durationSeconds)}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        {/* Sidebar — quick actions + agent status */}
        <div className="space-y-6">
          {/* Próximas citas */}
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-violet-600" />
                  Próximas citas
                </h3>
                <Badge tone="violet">{upcoming.length}</Badge>
              </div>
              {upcoming.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Cuando el agente agende una cita, aparece acá.
                </p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.map((u) => (
                    <li key={u.callId} className="flex gap-3">
                      <div className="h-8 w-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
                        <User className="h-3.5 w-3.5" />
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold tracking-tight">Estado del agente</h3>
                <Badge tone={stats.callsToday > 0 ? 'success' : 'neutral'}>
                  {stats.callsToday > 0 ? '● Activo' : 'Sin tráfico hoy'}
                </Badge>
              </div>
              <div className="space-y-3 text-sm">
                <Row label="Llamadas hoy" value={String(stats.callsToday)} />
                <Row label="Llamadas ayer" value={String(stats.callsYesterday)} />
                <Row label="Containment" value={`${stats.containmentRate}%`} />
                <Row label="AHT" value={formatDuration(stats.avgDurationSec)} />
              </div>
              <Button asChild variant="secondary" className="w-full mt-5" size="sm">
                <Link href="/dashboard/agent">Ajustar agente</Link>
              </Button>
            </div>
          </Card>

          {/* Distribución por motivo (últimos 7d) */}
          {motivos.length > 0 && (
            <Card>
              <div className="p-6">
                <h3 className="text-base font-semibold tracking-tight mb-1">Por motivo</h3>
                <p className="text-xs text-zinc-500 mb-4">Últimos 7 días</p>
                <MotivoBars motivos={motivos} />
              </div>
            </Card>
          )}

          <BackfillButton pending={pendingIntent} />

          <InsightsPanel />

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-3">Accesos rápidos</h3>
              <div className="space-y-2">
                <QuickAction
                  href="/dashboard/treatments"
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Editar tratamientos"
                />
                <QuickAction
                  href="/dashboard/analytics"
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Ver analytics"
                />
                <QuickAction
                  href="/dashboard/agent"
                  icon={<Bot className="h-4 w-4" />}
                  label="Probar llamada"
                />
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  delta,
  icon,
}: {
  label: string;
  value: string;
  delta: string;
  icon: React.ReactNode;
}) {
  const positive = delta.startsWith('+');
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <div className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
          {icon}
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        <span
          className={`inline-flex items-center gap-0.5 text-xs font-medium ${
            positive ? 'text-emerald-600' : 'text-zinc-500'
          }`}
        >
          <ArrowUpRight className="h-3 w-3" />
          {delta}
        </span>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
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

function IntentBadge({ intent }: { intent: string }) {
  const map: Record<
    string,
    { label: string; tone: 'success' | 'info' | 'violet' | 'warn' | 'danger' | 'neutral' }
  > = {
    agendar: { label: 'Agendar', tone: 'success' },
    reagendar: { label: 'Reagendar', tone: 'info' },
    cancelar: { label: 'Cancelar', tone: 'warn' },
    consulta: { label: 'Consulta', tone: 'violet' },
    pregunta: { label: 'Consulta', tone: 'violet' },
    queja: { label: 'Queja', tone: 'danger' },
    otro: { label: 'Otro', tone: 'neutral' },
  };
  const it = map[intent] ?? { label: intent, tone: 'neutral' as const };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

function MotivoBars({ motivos }: { motivos: Array<{ motivo: string; count: number }> }) {
  const labels: Record<string, { label: string; color: string }> = {
    agendar: { label: 'Agendar', color: 'bg-emerald-500' },
    reagendar: { label: 'Reagendar', color: 'bg-blue-500' },
    cancelar: { label: 'Cancelar', color: 'bg-amber-500' },
    consulta: { label: 'Consulta', color: 'bg-violet-500' },
    pregunta: { label: 'Consulta', color: 'bg-violet-500' },
    queja: { label: 'Queja', color: 'bg-red-500' },
    otro: { label: 'Otro', color: 'bg-zinc-400' },
    sin_clasificar: { label: 'Sin clasificar', color: 'bg-zinc-300' },
  };
  const total = Math.max(1, motivos.reduce((a, b) => a + b.count, 0));
  return (
    <div className="space-y-3">
      {motivos.map((m) => {
        const meta = labels[m.motivo] ?? { label: m.motivo, color: 'bg-zinc-400' };
        const pct = Math.round((m.count / total) * 100);
        return (
          <div key={m.motivo}>
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${meta.color}`} />
                <span className="font-medium text-zinc-700">{meta.label}</span>
              </div>
              <span className="text-zinc-500 tabular-nums">
                {m.count} <span className="text-zinc-400">· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
              <div className={`h-full ${meta.color} rounded-full`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
