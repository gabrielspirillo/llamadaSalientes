import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  getAppointmentsToday,
  getCancellationRecoveryStats,
  getNoShowSeries,
  getNoShowStats,
  getOptimizedRevenueMTD,
  getTopTreatments,
} from '@/lib/data/analytics/global';
import { getDemoAnalytics } from '@/lib/demo-data';
import { CalendarCheck, Coins, MessageCircle, Phone, PhoneCall, TrendingDown } from 'lucide-react';
import { NoShowTrendChart, TopTreatmentsChart } from './analytics-global-charts';

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

function formatPercent(rate: number, digits = 1): string {
  return `${(rate * 100).toFixed(digits)}%`;
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

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Métricas globales
        </h2>
        <span className="text-xs text-zinc-400">Cross-channel</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <KpiCard
          label="Citas hoy"
          value={String(today)}
          hint="Agendadas y confirmadas"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
        <KpiCard
          label="No-show (90 días)"
          value={formatPercent(noShow.rate)}
          hint={`${noShow.noShow} de ${noShow.finished} citas finalizadas`}
          icon={<TrendingDown className="h-4 w-4" />}
          tone="warn"
        />
        <KpiCard
          label="Revenue slots optimizados"
          value={formatMoney(revenue.cents, revenue.currency)}
          hint="Acumulado del mes"
          icon={<Coins className="h-4 w-4" />}
          tone="success"
        />
        <KpiCard
          label="Recuperación de cancelaciones"
          value={formatPercent(recovery.rate)}
          hint={`${recovery.recovered} de ${recovery.totalCancelled} canceladas`}
          icon={<CalendarCheck className="h-4 w-4" />}
        />
      </div>

      {revenue.cents > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Revenue por canal (MTD)
            </span>
            <ChannelChip
              icon={<PhoneCall className="h-3.5 w-3.5" />}
              label="Salientes"
              value={formatMoney(revenue.byChannel.outbound, revenue.currency)}
            />
            <ChannelChip
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Entrantes"
              value={formatMoney(revenue.byChannel.inbound, revenue.currency)}
            />
            <ChannelChip
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              label="WhatsApp"
              value={formatMoney(revenue.byChannel.whatsapp, revenue.currency)}
            />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-4 sm:p-5 pb-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Tendencia de no-show</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Semanal, últimos 90 días</p>
            </div>
            <Badge tone="warn">3 meses</Badge>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2">
            <NoShowTrendChart data={noShowSeries} />
          </div>
        </Card>

        <Card>
          <div className="p-4 sm:p-5 pb-2">
            <h3 className="text-base font-semibold tracking-tight">Top tratamientos</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Últimos 30 días</p>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2">
            <TopTreatmentsChart data={treatments} />
          </div>
        </Card>
      </div>
    </section>
  );
}

type Tone = 'default' | 'success' | 'warn';

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: Tone;
}) {
  const accent =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-zinc-100 text-zinc-600';
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <div className={`h-7 w-7 inline-flex items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <span className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
      </div>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

function ChannelChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className="text-zinc-400">{icon}</span>
      <span className="text-zinc-500">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}
