import { OutboundTrendChart } from '@/components/dashboard/analytics-module-charts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState as UiEmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { ProgressBar, StatTile } from '@/components/ui/stat';
import {
  getCampaignPerformance,
  getOutboundDailyTrend,
  getOutboundKPIs,
} from '@/lib/data/analytics/outbound';
import { ArrowRight, CheckCircle2, Coins, PhoneOutgoing, TrendingUp, Users } from 'lucide-react';
import Link from 'next/link';
import { ModuleUnavailable } from './module-error';

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function formatMoney(cents: number, currency = 'EUR'): string {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export async function OutboundModule({ tenantId }: { tenantId: string }) {
  const result = await (async () => {
    try {
      return {
        ok: true as const,
        data: await Promise.all([
          getOutboundKPIs(tenantId, 30),
          getOutboundDailyTrend(tenantId, 30),
          getCampaignPerformance(tenantId, 30, 8),
        ]),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  if (!result.ok) return <ModuleUnavailable label="salientes" detail={result.error} />;
  const [kpis, trend, campaigns] = result.data;

  if (kpis.callsAttempted === 0 && campaigns.length === 0) {
    return <OutboundEmpty />;
  }

  // Serie corta para el sparkline de la tarjeta de llamadas.
  const attemptedTrend = trend.slice(-12).map((d) => d.attempted);

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Llamadas (30 días)"
            numeric={kpis.callsAttempted}
            hint={`${kpis.ended} contactos efectivos`}
            icon={<PhoneOutgoing className="h-4 w-4" />}
            tone="blossom"
            trend={attemptedTrend.length > 1 ? attemptedTrend : undefined}
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="Contact rate"
            numeric={kpis.contactRate * 100}
            suffix="%"
            hint="Llamadas con contacto humano"
            icon={<Users className="h-4 w-4" />}
            tone="grape"
            progress={kpis.contactRate * 100}
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Completion rate"
            numeric={kpis.completionRate * 100}
            suffix="%"
            hint={`${kpis.failed} fallidas`}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="sky"
            progress={kpis.completionRate * 100}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Revenue MTD"
            value={formatMoney(kpis.revenueAttributedCentsMTD)}
            hint={`${kpis.appointmentsBookedMTD} citas atribuidas`}
            icon={<Coins className="h-4 w-4" />}
            tone="mint"
          />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        <Reveal direction="left" className="xl:col-span-2">
          <Card className="group h-full">
            <CardTopbar
              icon={<TrendingUp className="h-4 w-4" />}
              tone="blossom"
              title="Tendencia diaria"
              subtitle="Últimos 30 días"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/outbound">
                    Ver campañas
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
              }
            />
            <div className="px-4 pb-5 sm:px-5">
              <OutboundTrendChart data={trend} />
            </div>
          </Card>
        </Reveal>

        <Reveal direction="right">
          <Card className="h-full">
            <CardTopbar
              icon={<PhoneOutgoing className="h-4 w-4" />}
              tone="grape"
              title="Campañas recientes"
              subtitle="Performance últimos 30 días"
            />
            <div className="space-y-3 px-5 pb-5 sm:px-6 sm:pb-6">
              {campaigns.length === 0 ? (
                <p className="text-[13px] text-zinc-500">Sin campañas en el período.</p>
              ) : (
                campaigns.map((c, i) => (
                  <div
                    key={c.campaignId}
                    className="rounded-2xl border border-[--color-border] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_12px_26px_-18px_rgba(23,20,41,0.5)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-zinc-800">
                          {c.name}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-zinc-500">
                          {c.attempted} llamadas · {formatPercent(c.contactRate)} contact rate
                        </p>
                      </div>
                      <CampaignStatusBadge status={c.status} />
                    </div>
                    <ProgressBar
                      value={c.contactRate * 100}
                      tone="blossom"
                      className="mt-2.5"
                      delay={150 + i * 80}
                    />
                  </div>
                ))
              )}
            </div>
          </Card>
        </Reveal>
      </div>
    </>
  );
}

function OutboundEmpty() {
  return (
    <Card>
      <UiEmptyState
        icon={<PhoneOutgoing className="h-5 w-5" />}
        title="Llamadas salientes"
        description="Cuando lances tu primera campaña vas a ver acá contact rate, completion, tendencia diaria y revenue atribuido por slot optimizado."
        action={
          <Button asChild size="sm">
            <Link href="/dashboard/outbound">
              Crear campaña <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />
    </Card>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; tone: 'success' | 'info' | 'warn' | 'neutral' | 'danger' }
  > = {
    draft: { label: 'Borrador', tone: 'neutral' },
    dispatching: { label: 'Despachando', tone: 'info' },
    running: { label: 'En curso', tone: 'success' },
    paused: { label: 'Pausada', tone: 'warn' },
    completed: { label: 'Completa', tone: 'neutral' },
    failed: { label: 'Falló', tone: 'danger' },
  };
  const s = map[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
