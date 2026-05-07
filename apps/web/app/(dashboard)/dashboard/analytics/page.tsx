import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { mockCallsByHour, mockIntentBreakdown, mockStats } from '@/lib/mock-data';
import { ArrowUpRight, Calendar, Clock, PhoneCall, TrendingUp } from 'lucide-react';

export default function AnalyticsPage() {
  const maxCalls = Math.max(...mockCallsByHour.map((h) => h.calls));
  const totalIntents = mockIntentBreakdown.reduce((acc, i) => acc + i.count, 0);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Métricas en tiempo real de tu agente de voz."
        demoBadge
        actions={
          <>
            <Button variant="secondary" size="sm">
              Hoy
            </Button>
            <Button variant="ghost" size="sm">
              7 días
            </Button>
            <Button variant="ghost" size="sm">
              30 días
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <BigStat
          label="Total llamadas"
          value="247"
          delta="+18%"
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <BigStat
          label="AHT promedio"
          value={mockStats.aht}
          delta={mockStats.ahtDelta}
          icon={<Clock className="h-4 w-4" />}
        />
        <BigStat
          label="Citas creadas"
          value="158"
          delta="+24%"
          icon={<Calendar className="h-4 w-4" />}
        />
        <BigStat
          label="Containment"
          value={`${mockStats.containmentRate}%`}
          delta={mockStats.containmentDelta}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Calls by hour */}
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-6 pb-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Llamadas por hora</h3>
              <p className="text-sm text-zinc-500 mt-0.5">Distribución del día</p>
            </div>
            <Badge>Hoy</Badge>
          </div>
          <div className="px-6 pb-6 pt-4">
            <div className="flex items-end gap-2 h-56">
              {mockCallsByHour.map((h) => (
                <div key={h.hour} className="flex-1 flex flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-b from-zinc-900 to-zinc-700 transition-all hover:from-blue-600 hover:to-blue-500"
                    style={{ height: `${(h.calls / maxCalls) * 100}%` }}
                  />
                  <span className="text-[10px] text-zinc-400 tabular-nums">{h.hour}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Intent breakdown */}
        <Card>
          <div className="p-6">
            <h3 className="text-base font-semibold tracking-tight">Por intención</h3>
            <p className="text-sm text-zinc-500 mt-0.5">Últimos 30 días</p>

            <div className="mt-6 space-y-3.5">
              {mockIntentBreakdown.map((it) => {
                const pct = Math.round((it.count / totalIntents) * 100);
                return (
                  <div key={it.intent}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${it.color}`} />
                        <span className="font-medium">{it.intent}</span>
                      </div>
                      <span className="text-zinc-500 tabular-nums">
                        {it.count} <span className="text-xs">· {pct}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={`h-full ${it.color} rounded-full`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* Funnel */}
      <Card className="mt-6">
        <div className="p-6">
          <h3 className="text-base font-semibold tracking-tight">Embudo de conversión</h3>
          <p className="text-sm text-zinc-500 mt-0.5">Llamada → cita confirmada</p>

          <div className="mt-7 grid grid-cols-4 gap-3">
            <FunnelStep label="Llamadas" value="247" pct={100} />
            <FunnelStep label="Intent identificado" value="221" pct={89} />
            <FunnelStep label="Disponibilidad ofrecida" value="186" pct={75} />
            <FunnelStep label="Cita confirmada" value="158" pct={64} />
          </div>
        </div>
      </Card>
    </>
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

function FunnelStep({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-2">{label}</p>
      <div className="rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-700 text-white p-4">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-zinc-300 mt-1">{pct}% del total</p>
      </div>
    </div>
  );
}
