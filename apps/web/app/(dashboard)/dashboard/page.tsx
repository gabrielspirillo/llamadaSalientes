import { DemoBanner } from '@/components/dashboard/demo-banner';
import { GlobalAnalyticsBar } from '@/components/dashboard/global-analytics-bar';
import { PageHeader } from '@/components/dashboard/page-header';
import { RealtimeRefresh } from '@/components/dashboard/realtime-refresh';
import { Badge, StatusDot, Tag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { Avatar, Equalizer } from '@/components/ui/stat';
import { getUpcomingAppointments } from '@/lib/data/calls-list';
import { getDemoUpcoming } from '@/lib/demo-data';
import { getCurrentTenant } from '@/lib/tenant';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  MessageCircle,
  Phone,
  PhoneOutgoing,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import Link from 'next/link';

export default async function DashboardOverview({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const { tenant } = await getCurrentTenant();
  const demo = (await searchParams).demo === '1';
  const upcoming = demo ? getDemoUpcoming() : await getUpcomingAppointments(tenant.id, 8);

  const clinicName = tenant.name.split(/['']s|\s/)[0];

  return (
    <>
      <PageHeader
        eyebrow="Panel general"
        title={`Buenas, ${clinicName}`}
        description="Resumen en tiempo real de tu clínica: llamadas, citas y recuperación de huecos."
        icon={<Sparkles className="h-5 w-5" />}
        demoBadge={demo}
        actions={
          demo ? (
            <Button asChild variant="secondary">
              <Link href="/dashboard">Salir del demo</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="secondary">
                <Link href="/dashboard?demo=1">
                  <Sparkles className="h-4 w-4" /> Ver demo
                </Link>
              </Button>
              <Button asChild>
                <Link href="/dashboard/agent">
                  Probar agente
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
          <RealtimeRefresh intervalMs={30_000} />
        </div>
      )}

      {demo && <DemoBanner />}

      <GlobalAnalyticsBar tenantId={tenant.id} demo={demo} />

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        {/* --- Próximas citas ------------------------------------------------ */}
        <Reveal direction="left" className="xl:col-span-2">
          <Card className="group h-full overflow-hidden">
            <CardTopbar
              icon={<CalendarClock className="h-4 w-4" />}
              tone="grape"
              title="Próximas citas"
              subtitle="Agendadas y confirmadas por el agente"
              action={
                <>
                  <Badge tone="brand" size="lg">
                    {upcoming.length}
                  </Badge>
                  <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                    <Link href="/dashboard/calls">
                      Ver llamadas
                      <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                    </Link>
                  </Button>
                </>
              }
            />

            <div className="border-t border-[--color-border-subtle]">
              {upcoming.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock className="h-5 w-5" />}
                  title="Sin próximas citas"
                  description="Cuando el agente agende una cita, aparece acá al instante."
                  action={
                    <Button asChild size="sm" variant="soft">
                      <Link href="/dashboard/agent">Probar el agente</Link>
                    </Button>
                  }
                />
              ) : (
                <ul className="stagger p-2" style={{ ['--stagger-step' as string]: '55ms' }}>
                  {upcoming.map((u, i) => {
                    const name = u.patientName ?? u.phone ?? 'Paciente';
                    const when = u.startTime.toLocaleString('es-ES', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    return (
                      <li key={u.callId} style={{ ['--i' as string]: i }}>
                        <div className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-all duration-300 hover:bg-brand-50/50">
                          <Avatar name={name} size={38} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[14px] font-semibold text-zinc-800">
                              {name}
                            </p>
                            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-zinc-500">
                              <span className="truncate">{when}</span>
                            </p>
                          </div>
                          {u.treatmentName && (
                            <Tag className="hidden shrink-0 sm:inline-flex">{u.treatmentName}</Tag>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </Reveal>

        {/* --- Columna lateral ----------------------------------------------- */}
        <div className="space-y-4 sm:space-y-6">
          <Reveal direction="right">
            <Card tone="night" className="overflow-hidden p-6">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 animate-float rounded-full bg-[radial-gradient(circle,rgba(236,72,153,0.5),transparent_70%)] blur-2xl"
              />
              <div className="relative">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90 ring-1 ring-inset ring-white/15">
                  <StatusDot tone="success" />
                  Agente en línea
                  <Equalizer className="text-emerald-300" />
                </span>
                <h3 className="mt-4 text-[19px] font-bold leading-snug tracking-tight">
                  Tu recepcionista IA nunca cuelga
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-white/70">
                  Atiende llamadas, agenda, reagenda y recupera cancelaciones 24/7 — también por
                  WhatsApp.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button asChild variant="glass" size="sm">
                    <Link href="/dashboard/agent">
                      <Bot className="h-4 w-4" />
                      Probar llamada
                    </Link>
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    <Link href="/dashboard/analytics">Ver métricas</Link>
                  </Button>
                </div>
              </div>
            </Card>
          </Reveal>

          <Reveal direction="right" delay={100}>
            <Card>
              <CardTopbar
                icon={<Sparkles className="h-4 w-4" />}
                tone="blossom"
                title="Accesos rápidos"
                subtitle="Lo que más se usa cada día"
              />
              <div className="grid grid-cols-2 gap-2.5 p-5 pt-0 sm:p-6 sm:pt-0">
                <QuickTile
                  href="/dashboard/agent"
                  icon={<Bot className="h-4 w-4" />}
                  label="Probar agente"
                  tone="grape"
                />
                <QuickTile
                  href="/dashboard/treatments"
                  icon={<Stethoscope className="h-4 w-4" />}
                  label="Tratamientos"
                  tone="mint"
                />
                <QuickTile
                  href="/dashboard/outbound"
                  icon={<PhoneOutgoing className="h-4 w-4" />}
                  label="Nueva campaña"
                  tone="blossom"
                />
                <QuickTile
                  href="/dashboard/whatsapp"
                  icon={<MessageCircle className="h-4 w-4" />}
                  label="Inbox WhatsApp"
                  tone="mint"
                />
                <QuickTile
                  href="/dashboard/analytics"
                  icon={<BarChart3 className="h-4 w-4" />}
                  label="Analytics"
                  tone="sky"
                />
                <QuickTile
                  href="/dashboard/configuration?tab=telephony"
                  icon={<Phone className="h-4 w-4" />}
                  label="Telefonía"
                  tone="honey"
                />
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
    </>
  );
}

const TILE_TONE = {
  grape: 'bg-[#f4f0ff] text-violet-700 hover:bg-[#ede5ff]',
  blossom: 'bg-[#fdf0f7] text-pink-700 hover:bg-[#fbe4f0]',
  mint: 'bg-[#e9f9f2] text-emerald-700 hover:bg-[#d9f5e8]',
  sky: 'bg-[#e9f4fe] text-sky-700 hover:bg-[#d8ecfd]',
  honey: 'bg-[#fdf5e6] text-amber-700 hover:bg-[#fbecd3]',
} as const;

function QuickTile({
  href,
  icon,
  label,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  tone: keyof typeof TILE_TONE;
}) {
  return (
    <Link
      href={href}
      className={`group/tile flex flex-col gap-2.5 rounded-2xl p-3.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_28px_-18px_rgba(23,20,41,0.5)] ${TILE_TONE[tone]}`}
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 transition-transform duration-300 group-hover/tile:scale-110 group-hover/tile:-rotate-6">
        {icon}
      </span>
      <span className="text-[12.5px] font-semibold leading-tight">{label}</span>
    </Link>
  );
}
