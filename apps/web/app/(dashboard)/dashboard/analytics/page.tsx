import { PageHeader } from '@/components/dashboard/page-header';
import {
  CallsTrendChart,
  IntentBarList,
  IntentDonut,
} from '@/components/dashboard/analytics-charts';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { type AnalyticsRange, getAnalytics } from '@/lib/data/analytics';
import { formatDuration } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowUpRight, Calendar, Clock, PhoneCall, TrendingUp } from 'lucide-react';
import Link from 'next/link';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: AnalyticsRange }>;
}) {
  const sp = await searchParams;
  const range: AnalyticsRange = sp.range === '7d' || sp.range === '30d' ? sp.range : 'today';
  const { tenant } = await getCurrentTenant();
  const data = await getAnalytics(tenant.id, range);

  const maxByHour = Math.max(1, ...data.byHour.map((h) => h.calls));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Métricas reales de tu agente de voz."
        actions={
          <div className="inline-flex items-center rounded-full border border-zinc-200 bg-white p-1 text-xs">
            <RangePill href="/dashboard/analytics?range=today" active={range === 'today'} label="Hoy" />
            <RangePill href="/dashboard/analytics?range=7d" active={range === '7d'} label="7 días" />
            <RangePill href="/dashboard/analytics?range=30d" active={range === '30d'} label="30 días" />
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <BigStat
          label="Total llamadas"
          value={String(data.total)}
          delta={data.total === 0 ? '—' : 'período actual'}
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <BigStat
          label="AHT promedio"
          value={formatDuration(data.avgDurationSec)}
          delta="—"
          icon={<Clock className="h-4 w-4" />}
        />
        <BigStat
          label="Citas creadas"
          value={String(data.booked)}
          delta={data.total === 0 ? '—' : `${Math.round((data.booked / Math.max(1, data.total)) * 100)}% del total`}
          icon={<Calendar className="h-4 w-4" />}
        />
        <BigStat
          label="Containment"
          value={`${data.containment}%`}
          delta={`${data.transferred} transferidas`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {data.total === 0 ? (
        <Card>
          <div className="p-12 text-center">
            <p className="text-base font-semibold tracking-tight">Sin datos en este rango</p>
            <p className="text-sm text-zinc-500 mt-1">
              Cuando llegue la primera llamada, los gráficos se llenan automáticamente.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Tendencia diaria con Tremor */}
          {range !== 'today' && (
            <Card>
              <div className="flex items-center justify-between p-6 pb-2">
                <div>
                  <h3 className="text-base font-semibold tracking-tight">Tendencia diaria</h3>
                  <p className="text-sm text-zinc-500 mt-0.5">
                    Llamadas apiladas por intención
                  </p>
                </div>
                <Badge>{range === '7d' ? '7 días' : '30 días'}</Badge>
              </div>
              <div className="px-6 pb-6 pt-4">
                <CallsTrendChart data={data.byDay} />
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <Card className="xl:col-span-2">
              <div className="flex items-center justify-between p-6 pb-2">
                <div>
                  <h3 className="text-base font-semibold tracking-tight">Llamadas por hora</h3>
                  <p className="text-sm text-zinc-500 mt-0.5">Distribución del período</p>
                </div>
                <Badge>{range === 'today' ? 'Hoy' : range === '7d' ? '7 días' : '30 días'}</Badge>
              </div>
              <div className="px-6 pb-6 pt-4">
                <div className="flex items-end gap-1.5 h-56">
                  {data.byHour.map((h) => (
                    <div key={h.hour} className="flex-1 flex flex-col items-center gap-2">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-b from-zinc-900 to-zinc-700 transition-all hover:from-blue-600 hover:to-blue-500 min-h-[2px]"
                        style={{ height: `${(h.calls / maxByHour) * 100}%` }}
                        title={`${h.hour}:00 — ${h.calls} llamadas`}
                      />
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {h.hour.toString().padStart(2, '0')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card>
              <div className="p-6">
                <h3 className="text-base font-semibold tracking-tight">Por intención</h3>
                <p className="text-sm text-zinc-500 mt-0.5">Distribución</p>
                <div className="mt-4">
                  <IntentDonut data={data.intents} />
                </div>
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <IntentBarList data={data.intents} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function RangePill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-full transition-colors ${
        active ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:text-zinc-900'
      }`}
    >
      {label}
    </Link>
  );
}

function BigStat({
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
        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-zinc-500">
          <ArrowUpRight className="h-3 w-3" />
          {delta}
        </span>
      </div>
    </Card>
  );
}
