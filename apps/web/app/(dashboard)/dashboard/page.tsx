import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { mockCalls, mockStats } from '@/lib/mock-data';
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Calendar,
  Clock,
  PhoneCall,
  Stethoscope,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

export default function DashboardOverview() {
  return (
    <>
      <PageHeader
        title="Buenos días"
        description="Esto es lo que pasó en tu clínica en las últimas 24 horas."
        demoBadge
        actions={
          <Button asChild>
            <Link href="/dashboard/agent">
              Probar agente <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Llamadas hoy"
          value={String(mockStats.callsToday)}
          delta={mockStats.callsTodayDelta}
          icon={<PhoneCall className="h-4 w-4" />}
        />
        <StatCard
          label="Tiempo promedio"
          value={mockStats.aht}
          delta={mockStats.ahtDelta}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Conversión a cita"
          value={`${mockStats.conversionRate}%`}
          delta={mockStats.conversionDelta}
          icon={<Calendar className="h-4 w-4" />}
        />
        <StatCard
          label="Resueltas por IA"
          value={`${mockStats.containmentRate}%`}
          delta={mockStats.containmentDelta}
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
            {mockCalls.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/calls/${c.id}`}
                className="flex items-center justify-between gap-4 px-6 py-3.5 hover:bg-zinc-50/60 transition-colors border-b border-zinc-50 last:border-b-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${
                      c.sentiment === 'positive'
                        ? 'bg-emerald-500'
                        : c.sentiment === 'negative'
                          ? 'bg-red-500'
                          : 'bg-zinc-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.patientName}</p>
                    <p className="text-xs text-zinc-500 truncate">{c.summary}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <IntentBadge intent={c.intent} />
                  <span className="text-xs text-zinc-400 tabular-nums w-12 text-right">
                    {c.duration}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>

        {/* Sidebar — quick actions + agent status */}
        <div className="space-y-6">
          <Card>
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold tracking-tight">Estado del agente</h3>
                <Badge tone="success">● Activo</Badge>
              </div>
              <div className="space-y-3 text-sm">
                <Row label="Voz" value="Sofía (ES)" />
                <Row label="Versión de prompt" value="v3 · publicado" />
                <Row label="Número Twilio" value="+52 555 100 2030" />
                <Row label="Última prueba" value="hace 2 días" />
              </div>
              <Button asChild variant="secondary" className="w-full mt-5" size="sm">
                <Link href="/dashboard/agent">Ajustar agente</Link>
              </Button>
            </div>
          </Card>

          <Card>
            <div className="p-6">
              <h3 className="text-base font-semibold tracking-tight mb-1">Esta semana</h3>
              <p className="text-sm text-zinc-500 mb-4">Comparado con la anterior</p>
              <div className="space-y-3">
                <SparkRow label="Citas creadas" value="38" delta="+12" tone="success" />
                <SparkRow label="Cancelaciones" value="6" delta="-2" tone="success" />
                <SparkRow label="Transferidas a humano" value="11" delta="+3" tone="warn" />
              </div>
            </div>
          </Card>

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

function SparkRow({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'success' | 'warn' | 'danger';
}) {
  const color =
    tone === 'success' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-600">{label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        <span className="font-medium">{value}</span>
        <span className={`text-xs ${color}`}>{delta}</span>
      </div>
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
    book: { label: 'Agendar', tone: 'success' },
    reschedule: { label: 'Reagendar', tone: 'info' },
    cancel: { label: 'Cancelar', tone: 'warn' },
    pricing: { label: 'Precios', tone: 'violet' },
    faq: { label: 'FAQ', tone: 'neutral' },
    human: { label: 'Humano', tone: 'danger' },
    other: { label: 'Otro', tone: 'neutral' },
  };
  const it = map[intent] ?? { label: intent, tone: 'neutral' as const };
  return <Badge tone={it.tone}>{it.label}</Badge>;
}
