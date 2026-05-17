import { OutboundTrendChart } from '@/components/dashboard/analytics-module-charts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getCampaignPerformance,
  getOutboundDailyTrend,
  getOutboundKPIs,
} from '@/lib/data/analytics/outbound';
import { ArrowRight, CheckCircle2, Coins, PhoneOutgoing, Users } from 'lucide-react';
import Link from 'next/link';

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function formatMoney(cents: number, currency = 'USD'): string {
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
  const [kpis, trend, campaigns] = await Promise.all([
    getOutboundKPIs(tenantId, 30),
    getOutboundDailyTrend(tenantId, 30),
    getCampaignPerformance(tenantId, 30, 8),
  ]);

  if (kpis.callsAttempted === 0 && campaigns.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Llamadas (30 días)"
          value={String(kpis.callsAttempted)}
          hint={`${kpis.ended} contactos efectivos`}
          icon={<PhoneOutgoing className="h-4 w-4" />}
        />
        <KpiCard
          label="Contact rate"
          value={formatPercent(kpis.contactRate)}
          hint="Llamadas con contacto humano"
          icon={<Users className="h-4 w-4" />}
        />
        <KpiCard
          label="Completion rate"
          value={formatPercent(kpis.completionRate)}
          hint={`${kpis.failed} fallidas`}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard
          label="Revenue MTD"
          value={formatMoney(kpis.revenueAttributedCentsMTD)}
          hint={`${kpis.appointmentsBookedMTD} citas atribuidas`}
          icon={<Coins className="h-4 w-4" />}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-5 pb-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Tendencia diaria</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Últimos 30 días</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/outbound">
                Ver campañas <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="px-5 pb-5 pt-2">
            <OutboundTrendChart data={trend} />
          </div>
        </Card>

        <Card>
          <div className="p-5 pb-2">
            <h3 className="text-base font-semibold tracking-tight">Campañas recientes</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Performance últimos 30 días</p>
          </div>
          <div className="px-5 pb-5 pt-2 space-y-3">
            {campaigns.length === 0 ? (
              <p className="text-sm text-zinc-500">Sin campañas en el período.</p>
            ) : (
              campaigns.map((c) => (
                <div key={c.campaignId} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="text-xs text-zinc-500">
                      {c.attempted} llamadas · {formatPercent(c.contactRate)} contact rate
                    </p>
                  </div>
                  <CampaignStatusBadge status={c.status} />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <Card>
      <div className="px-6 py-16 text-center max-w-md mx-auto">
        <div className="h-12 w-12 inline-flex items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 mb-4">
          <PhoneOutgoing className="h-5 w-5" />
        </div>
        <p className="text-base font-semibold tracking-tight">Llamadas salientes</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          Cuando lances tu primera campaña aparecerán contact rate, completion, tendencia
          diaria y revenue atribuido por slot optimizado.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href="/dashboard/outbound">
            Crear campaña <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
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
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <div className={`h-7 w-7 inline-flex items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}

function CampaignStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'success' | 'info' | 'warn' | 'neutral' | 'danger' }> = {
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
