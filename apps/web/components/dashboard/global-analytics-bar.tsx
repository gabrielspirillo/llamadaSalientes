import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { StatTile } from '@/components/ui/stat';
import {
  getAppointmentsToday,
  getCancellationRecoveryStats,
  getNoShowSeries,
  getNoShowStats,
  getOptimizedRevenueMTD,
  getTopTreatments,
} from '@/lib/data/analytics/global';
import { getDemoAnalytics } from '@/lib/demo-data';
import {
  CalendarCheck,
  Coins,
  MessageCircle,
  Phone,
  PhoneCall,
  Sparkles,
  Stethoscope,
  TrendingDown,
} from 'lucide-react';
import { NoShowTrendChart, TopTreatmentsChart } from './charts-lazy';

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
}: {
  tenantId: string;
  demo?: boolean;
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

  // Serie corta para el sparkline de la tarjeta de no-show.
  const noShowTrend = noShowSeries.slice(-10).map((p) => p.rate * 100);

  return (
    <section className="mb-8">
      <SectionTitle
        title="Métricas globales"
        description="Todos los canales combinados: llamadas, WhatsApp, recordatorios y waitlist."
        action={
          <Badge tone="accent" size="lg" className="hidden sm:inline-flex">
            <Sparkles className="h-3 w-3" />
            Cross-channel
          </Badge>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Citas hoy"
            numeric={today}
            hint="Agendadas y confirmadas"
            icon={<CalendarCheck className="h-4 w-4" />}
            tone="grape"
          />
        </Reveal>
        <Reveal delay={80}>
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
        <Reveal delay={160}>
          <StatTile
            label="Revenue optimizado"
            value={formatMoney(revenue.cents, revenue.currency)}
            hint="Slots recuperados este mes"
            icon={<Coins className="h-4 w-4" />}
            tone="mint"
          />
        </Reveal>
        <Reveal delay={240}>
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

      {revenue.cents > 0 && (
        <Reveal>
          <Card className="mb-4 overflow-hidden p-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 p-4 sm:px-5">
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
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

      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3">
        <Reveal direction="left" className="xl:col-span-2">
          <Card className="group h-full">
            <CardTopbar
              icon={<TrendingDown className="h-4 w-4" />}
              tone="honey"
              title="Tendencia de no-show"
              subtitle="Semanal, últimos 90 días"
              action={<Badge tone="warn">3 meses</Badge>}
            />
            <div className="px-4 pb-5 sm:px-5">
              <NoShowTrendChart data={noShowSeries} />
            </div>
          </Card>
        </Reveal>

        <Reveal direction="right">
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
