import { BackfillButton } from '@/components/dashboard/backfill-button';
import { InsightsPanel } from '@/components/dashboard/insights-panel';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { Avatar, ProgressBar, StatTile } from '@/components/ui/stat';
import {
  countCallsPendingIntent,
  formatDuration,
  formatRelativeTime,
  getDashboardStats,
  getMotivoBreakdown,
  getUpcomingAppointments,
  listCalls,
} from '@/lib/data/calls-list';
import {
  ArrowRight,
  Bot,
  Calendar,
  CalendarClock,
  Clock,
  PhoneCall,
  Sparkles,
  Stethoscope,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

export async function InboundModule({ tenantId }: { tenantId: string }) {
  const [stats, recentCalls, upcoming, motivos, pendingIntent] = await Promise.all([
    getDashboardStats(tenantId),
    listCalls(tenantId, 6),
    getUpcomingAppointments(tenantId, 5),
    getMotivoBreakdown(tenantId),
    countCallsPendingIntent(tenantId),
  ]);

  const delta = stats.callsToday - stats.callsYesterday;

  return (
    <>
      {/* --- KPIs ------------------------------------------------------------ */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:mb-8 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Llamadas hoy"
            numeric={stats.callsToday}
            delta={delta}
            hint={`Ayer: ${stats.callsYesterday}`}
            icon={<PhoneCall className="h-4 w-4" />}
            tone="grape"
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="Tiempo promedio"
            value={formatDuration(stats.avgDurationSec)}
            hint="Duración media por llamada"
            icon={<Clock className="h-4 w-4" />}
            tone="sky"
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Conversión a cita"
            numeric={stats.conversionRate}
            suffix="%"
            hint="Llamadas que terminan agendando"
            icon={<Calendar className="h-4 w-4" />}
            tone="mint"
            progress={stats.conversionRate}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Resueltas por IA"
            numeric={stats.containmentRate}
            suffix="%"
            hint="Sin intervención humana"
            icon={<Bot className="h-4 w-4" />}
            tone="blossom"
            progress={stats.containmentRate}
          />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        {/* --- Últimas llamadas --------------------------------------------- */}
        <Reveal direction="left" className="xl:col-span-2">
          <Card className="group h-full overflow-hidden">
            <CardTopbar
              icon={<PhoneCall className="h-4 w-4" />}
              tone="grape"
              title="Últimas llamadas"
              subtitle="Actualizado en tiempo real"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/calls">
                    Ver todas
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
              }
            />
            <div className="border-t border-[--color-border-subtle]">
              {recentCalls.length === 0 ? (
                <EmptyState
                  icon={<PhoneCall className="h-5 w-5" />}
                  title="Aún no hay llamadas"
                  description="Prueba el agente desde el panel o llama al número configurado."
                  action={
                    <Button asChild size="sm">
                      <Link href="/dashboard/agent">Probar agente ahora</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="stagger p-2" style={{ ['--stagger-step' as string]: '50ms' }}>
                  {recentCalls.map((c, i) => (
                    <li key={c.id} style={{ ['--i' as string]: i }}>
                      <Link
                        href={`/dashboard/calls/${c.id}`}
                        className="flex items-center justify-between gap-3 rounded-2xl px-3 py-3 transition-all duration-300 hover:bg-zinc-50 sm:gap-4"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative">
                            <Avatar name={c.fromNumber ?? 'Anónimo'} size={38} />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${
                                c.sentiment === 'positivo'
                                  ? 'bg-emerald-500'
                                  : c.sentiment === 'negativo'
                                    ? 'bg-rose-500'
                                    : 'bg-zinc-300'
                              }`}
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-zinc-800">
                              {c.fromNumber ?? 'Llamada anónima'}
                            </p>
                            <p className="truncate text-[13px] text-zinc-500">
                              {c.summary ?? `Sin resumen aún · ${formatRelativeTime(c.startedAt)}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                          <IntentBadge intent={c.intent ?? 'otro'} />
                          <span className="hidden w-14 text-right text-[13px] tabular-nums text-zinc-500 sm:inline">
                            {formatDuration(c.durationSeconds)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </Reveal>

        {/* --- Columna lateral ----------------------------------------------- */}
        <div className="space-y-4 sm:space-y-6">
          <Reveal direction="right">
            <Card>
              <CardTopbar
                icon={<CalendarClock className="h-4 w-4" />}
                tone="grape"
                title="Próximas citas"
                action={<Badge tone="brand">{upcoming.length}</Badge>}
              />
              <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                {upcoming.length === 0 ? (
                  <p className="text-[14px] leading-relaxed text-zinc-500">
                    Cuando el agente agende una cita, aparece acá.
                  </p>
                ) : (
                  <ul
                    className="stagger space-y-2.5"
                    style={{ ['--stagger-step' as string]: '55ms' }}
                  >
                    {upcoming.map((u, i) => (
                      <li key={u.callId} className="flex gap-3" style={{ ['--i' as string]: i }}>
                        <Avatar name={u.patientName ?? u.phone ?? 'Paciente'} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-semibold text-zinc-800">
                            {u.patientName ?? u.phone ?? 'Paciente'}
                          </p>
                          <p className="truncate text-[13px] text-zinc-500">
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
          </Reveal>

          <Reveal direction="right" delay={80}>
            <Card>
              <CardTopbar
                icon={<Bot className="h-4 w-4" />}
                tone="mint"
                title="Estado del agente"
                action={
                  <Badge tone={stats.callsToday > 0 ? 'success' : 'neutral'}>
                    {stats.callsToday > 0 ? (
                      <>
                        <StatusDot tone="success" /> Activo
                      </>
                    ) : (
                      'Sin tráfico hoy'
                    )}
                  </Badge>
                }
              />
              <div className="space-y-2.5 px-5 pb-5 text-[14px] sm:px-6 sm:pb-6">
                <Row label="Llamadas hoy" value={String(stats.callsToday)} />
                <Row label="Llamadas ayer" value={String(stats.callsYesterday)} />
                <Row label="Containment" value={`${stats.containmentRate}%`} />
                <Row label="AHT" value={formatDuration(stats.avgDurationSec)} />
                <ProgressBar value={stats.containmentRate} tone="mint" className="pt-1" />
                <Button asChild variant="secondary" className="mt-4 w-full" size="sm">
                  <Link href="/dashboard/agent">Ajustar agente</Link>
                </Button>
              </div>
            </Card>
          </Reveal>

          {motivos.length > 0 && (
            <Reveal direction="right" delay={140}>
              <Card>
                <CardTopbar
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone="honey"
                  title="Por motivo"
                  subtitle="Últimos 7 días"
                />
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                  <MotivoBars motivos={motivos} />
                </div>
              </Card>
            </Reveal>
          )}

          <BackfillButton pending={pendingIntent} />

          <InsightsPanel />

          <Reveal direction="right" delay={200}>
            <Card>
              <CardTopbar
                icon={<Sparkles className="h-4 w-4" />}
                tone="blossom"
                title="Accesos rápidos"
              />
              <div className="space-y-2 px-5 pb-5 sm:px-6 sm:pb-6">
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
            </Card>
          </Reveal>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className="font-bold tabular-nums text-zinc-800">{value}</span>
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
      className="group/qa flex items-center gap-3 rounded-2xl border border-[--color-border] px-3.5 py-2.5 text-[14px] font-medium text-zinc-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-zinc-50 hover:text-brand-700"
    >
      <span className="text-zinc-400 transition-colors group-hover/qa:text-brand-500">{icon}</span>
      <span>{label}</span>
      <ArrowRight className="ml-auto h-3.5 w-3.5 text-zinc-300 transition-all duration-300 group-hover/qa:translate-x-1 group-hover/qa:text-brand-500" />
    </Link>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const map: Record<
    string,
    { label: string; tone: 'success' | 'info' | 'accent' | 'warn' | 'danger' | 'neutral' }
  > = {
    agendar: { label: 'Agendar', tone: 'success' },
    reagendar: { label: 'Reagendar', tone: 'info' },
    cancelar: { label: 'Cancelar', tone: 'warn' },
    consulta: { label: 'Consulta', tone: 'accent' },
    pregunta: { label: 'Consulta', tone: 'accent' },
    queja: { label: 'Queja', tone: 'danger' },
    otro: { label: 'Otro', tone: 'neutral' },
  };
  const it = map[intent] ?? { label: intent, tone: 'neutral' as const };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}

function MotivoBars({ motivos }: { motivos: Array<{ motivo: string; count: number }> }) {
  const labels: Record<string, { label: string; color: string }> = {
    agendar: { label: 'Agendar', color: 'bg-emerald-500' },
    reagendar: { label: 'Reagendar', color: 'bg-sky-500' },
    cancelar: { label: 'Cancelar', color: 'bg-amber-500' },
    consulta: { label: 'Consulta', color: 'bg-brand-500' },
    pregunta: { label: 'Consulta', color: 'bg-brand-500' },
    queja: { label: 'Queja', color: 'bg-rose-500' },
    otro: { label: 'Otro', color: 'bg-zinc-400' },
    sin_clasificar: { label: 'Sin clasificar', color: 'bg-zinc-300' },
  };
  const total = Math.max(
    1,
    motivos.reduce((a, b) => a + b.count, 0),
  );
  return (
    <div className="space-y-3">
      {motivos.map((m, i) => {
        const meta = labels[m.motivo] ?? { label: m.motivo, color: 'bg-zinc-400' };
        const pct = Math.round((m.count / total) * 100);
        return (
          <div key={m.motivo}>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${meta.color}`} />
                <span className="font-semibold text-zinc-700">{meta.label}</span>
              </div>
              <span className="tabular-nums text-zinc-500">
                {m.count} <span className="text-zinc-400">· {pct}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`bar-fill h-full rounded-full ${meta.color}`}
                style={{ width: `${pct}%`, ['--bar-delay' as string]: `${120 + i * 90}ms` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
