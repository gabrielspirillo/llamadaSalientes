import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { StatTile } from '@/components/ui/stat';
import { getClinicTimezone, tenantHasAgenda } from '@/lib/agenda/queries';
import { type AgendaPulse, getAgendaPulse } from '@/lib/data/analytics/agenda-pulse';
import {
  getAppointmentsToday,
  getCancellationRecoveryStats,
  getNoShowSeries,
  getNoShowStats,
  getOptimizedRevenueMTD,
  getTopTreatments,
} from '@/lib/data/analytics/global';
import type { TodayBoard } from '@/lib/data/analytics/today-board';
import { db } from '@/lib/db/client';
import { tasks, tenantMemberships } from '@/lib/db/schema';
import { getDemoAnalytics } from '@/lib/demo-data';
import { and, count, eq, isNull, ne } from 'drizzle-orm';
import {
  CalendarCheck,
  CalendarRange,
  Coins,
  ListTodo,
  MessageCircle,
  Phone,
  PhoneCall,
  Sparkles,
  Stethoscope,
  TrendingDown,
  Users,
} from 'lucide-react';
import { NoShowTrendChart, TopTreatmentsChart, WeeklyAppointmentsChart } from './charts-lazy';
import { PulseTiles } from './pulse-tiles';

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    // Currency code inválido — fallback a número plano con el código.
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export async function GlobalAnalyticsBar({
  tenantId,
  demo = false,
  board = null,
}: {
  tenantId: string;
  demo?: boolean;
  /** Citas por semana, si la clínica tiene agenda propia. */
  board?: TodayBoard | null;
}) {
  // En modo demo usamos el dataset ficticio; nunca tocamos la DB del tenant.
  const [noShow, revenue, recovery, today, treatments, noShowSeries] = demo
    ? getDemoAnalytics()
    : await Promise.all([
        getNoShowStats(tenantId, 90),
        getOptimizedRevenueMTD(tenantId),
        getCancellationRecoveryStats(tenantId, 90),
        getAppointmentsToday(tenantId),
        getTopTreatments(tenantId, 30, 5),
        getNoShowSeries(tenantId, 90),
      ]);

  // Clínica con agenda propia: los cuatro números de arriba salen de ella. Los
  // de antes (no-show sobre la caché de GHL, revenue de ofertas automáticas,
  // recuperación de huecos) se quedaban a cero en estas clínicas.
  const pulse: AgendaPulse | null =
    !demo && (await tenantHasAgenda(tenantId).catch(() => false))
      ? await getClinicTimezone(tenantId)
          .then((tz) => getAgendaPulse(tenantId, tz))
          .catch(() => null)
      : null;

  // Serie corta para el sparkline de la tarjeta de no-show.
  const noShowTrend = noShowSeries.slice(-10).map((p) => p.rate * 100);

  // Tres números más para completar el panorama: qué viene, qué hay pendiente
  // y quién lo lleva. En demo son valores de ejemplo; en real, consultas
  // baratas (best-effort: si alguna falla, queda en 0 y el resto se dibuja).
  const [openTasks, teamCount] = demo
    ? [7, 5]
    : await Promise.all([
        db
          .select({ n: count() })
          .from(tasks)
          .where(
            and(eq(tasks.tenantId, tenantId), ne(tasks.status, 'DONE'), isNull(tasks.archivedAt)),
          )
          .then((r) => Number(r[0]?.n ?? 0))
          .catch(() => 0),
        db
          .select({ n: count() })
          .from(tenantMemberships)
          .where(eq(tenantMemberships.tenantId, tenantId))
          .then((r) => Number(r[0]?.n ?? 0))
          .catch(() => 0),
      ]);

  return (
    <section className="mb-8">
      <SectionTitle
        title={pulse ? 'Tu agenda en directo' : 'Métricas globales'}
        description={
          pulse
            ? 'Hoy, los próximos 7 días y lo que hace el asistente por ti.'
            : 'Todos los canales combinados: llamadas, WhatsApp, recordatorios y waitlist.'
        }
      />

      {pulse ? (
        <PulseTiles pulse={pulse} />
      ) : (
        <div className="rise-stagger mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          <Reveal className="[--i:0]">
            <StatTile
              label="Citas hoy"
              numeric={today}
              hint="Agendadas y confirmadas"
              icon={<CalendarCheck className="h-4 w-4" />}
              tone="grape"
            />
          </Reveal>
          <Reveal className="[--i:1]">
            <StatTile
              label="No-show (90 días)"
              numeric={noShow.rate * 100}
              decimals={1}
              suffix="%"
              hint={`${noShow.noShow} de ${noShow.finished} citas finalizadas`}
              icon={<TrendingDown className="h-4 w-4" />}
              tone="honey"
              trend={noShowTrend.length > 1 ? noShowTrend : undefined}
            />
          </Reveal>
          <Reveal className="[--i:2]">
            <StatTile
              label="Revenue optimizado"
              value={formatMoney(revenue.cents, revenue.currency)}
              hint="Slots recuperados este mes"
              icon={<Coins className="h-4 w-4" />}
              tone="mint"
            />
          </Reveal>
          <Reveal className="[--i:3]">
            <StatTile
              label="Recuperación de cancelaciones"
              numeric={recovery.rate * 100}
              decimals={1}
              suffix="%"
              hint={`${recovery.recovered} de ${recovery.totalCancelled} canceladas`}
              icon={<CalendarCheck className="h-4 w-4" />}
              tone="sky"
              progress={recovery.rate * 100}
            />
          </Reveal>
        </div>
      )}

      {revenue.cents > 0 && (
        <Reveal>
          <Card className="mb-4 overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 p-4 sm:px-5">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                Revenue por canal · mes en curso
              </span>
              <div className="flex flex-wrap gap-2">
                <ChannelChip
                  icon={<PhoneCall className="h-3.5 w-3.5" />}
                  label="Salientes"
                  value={formatMoney(revenue.byChannel.outbound, revenue.currency)}
                  className="bg-emerald-50 text-emerald-700"
                />
                <ChannelChip
                  icon={<Phone className="h-3.5 w-3.5" />}
                  label="Entrantes"
                  value={formatMoney(revenue.byChannel.inbound, revenue.currency)}
                  className="bg-brand-50 text-brand-700"
                />
                <ChannelChip
                  icon={<MessageCircle className="h-3.5 w-3.5" />}
                  label="WhatsApp"
                  value={formatMoney(revenue.byChannel.whatsapp, revenue.currency)}
                  className="bg-emerald-50 text-emerald-700"
                />
              </div>
            </div>
          </Card>
        </Reveal>
      )}

      <div className="rise-stagger grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
        <Reveal className="[--i:0]">
          <Card className="group h-full">
            <CardTopbar
              icon={<TrendingDown className="h-4 w-4" />}
              tone="honey"
              title="Faltas por semana"
              subtitle="Últimos 90 días"
            />
            <div className="px-3 pb-4 sm:px-4">
              <NoShowTrendChart data={pulse ? pulse.noShowSeries : noShowSeries} />
            </div>
          </Card>
        </Reveal>

        {board && (
          <Reveal className="[--i:1]">
            <Card className="group h-full">
              <CardTopbar
                icon={<CalendarRange className="h-4 w-4" />}
                tone="grape"
                title="Citas por semana"
                subtitle="Ocho semanas, la actual en color"
              />
              <div className="px-3 pb-4 sm:px-4">
                <WeeklyAppointmentsChart data={board.weekly} />
              </div>
            </Card>
          </Reveal>
        )}

        <Reveal className={board ? '[--i:2]' : '[--i:1] xl:col-span-2'}>
          <Card className="group h-full">
            <CardTopbar
              icon={<Stethoscope className="h-4 w-4" />}
              tone="mint"
              title="Top tratamientos"
              subtitle="Últimos 30 días"
            />
            <div className="px-4 pb-5 sm:px-5">
              <TopTreatmentsChart data={treatments} />
            </div>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function ChannelChip({
  icon,
  label,
  value,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[14px] transition-transform duration-300 hover:scale-105 ${className}`}
    >
      <span className="opacity-70">{icon}</span>
      <span className="font-medium opacity-80">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}
