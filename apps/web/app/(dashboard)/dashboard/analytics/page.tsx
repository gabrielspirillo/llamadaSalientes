import {
  CallsTrendChart,
  IntentBarList,
  IntentDonut,
} from '@/components/dashboard/analytics-charts';
import { MessagingAnalyticsPanel } from '@/components/dashboard/messaging-analytics';
import { ModuleUnavailable } from '@/components/dashboard/modules/module-error';
import { OutboundModule } from '@/components/dashboard/modules/outbound-module';
import { WhatsappModule } from '@/components/dashboard/modules/whatsapp-module';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { StatTile } from '@/components/ui/stat';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type AnalyticsRange, getAnalytics } from '@/lib/data/analytics';
import { getMessagingAnalytics } from '@/lib/data/analytics/messaging';
import { formatDuration } from '@/lib/data/calls-list';
import { getCurrentTenant } from '@/lib/tenant';
import {
  BarChart3,
  Calendar,
  Clock,
  MessageCircle,
  Phone,
  PhoneCall,
  PhoneOutgoing,
  TrendingUp,
  Users,
} from 'lucide-react';
import Link from 'next/link';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: AnalyticsRange; tab?: string }>;
}) {
  const sp = await searchParams;
  const range: AnalyticsRange = sp.range === '7d' || sp.range === '30d' ? sp.range : 'today';
  const tab =
    sp.tab === 'outbound' || sp.tab === 'whatsapp' || sp.tab === 'team' ? sp.tab : 'inbound';
  const { tenant } = await getCurrentTenant();

  return (
    <>
      <PageHeader
        eyebrow="Rendimiento"
        title="Métricas"
        description="Datos reales de cada canal: llamadas entrantes, salientes, WhatsApp y equipo."
        icon={<BarChart3 className="h-5 w-5" />}
      />

      <Tabs defaultValue={tab}>
        <TabsList className="max-w-full">
          <TabsTrigger value="outbound">
            <PhoneOutgoing className="h-3.5 w-3.5 mr-1.5" />
            Salientes
          </TabsTrigger>
          <TabsTrigger value="inbound">
            <Phone className="h-3.5 w-3.5 mr-1.5" />
            Entrantes
          </TabsTrigger>
          <TabsTrigger value="whatsapp">
            <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Equipo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outbound">
          <OutboundModule tenantId={tenant.id} />
        </TabsContent>

        <TabsContent value="inbound">
          <InboundAnalytics tenantId={tenant.id} range={range} />
        </TabsContent>

        <TabsContent value="whatsapp">
          <WhatsappModule tenantId={tenant.id} />
        </TabsContent>

        <TabsContent value="team">
          <TeamAnalytics tenantId={tenant.id} range={range} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/**
 * Pestaña Equipo. La lectura va envuelta en try/catch a propósito: si la
 * migración del módulo Mensajes todavía no corrió, las tablas `im_` no existen
 * y la consulta explota. Eso no puede tirar Analytics entero — la pestaña
 * muestra su estado vacío y las otras tres siguen funcionando.
 */
async function TeamAnalytics({
  tenantId,
  range,
}: {
  tenantId: string;
  range: AnalyticsRange;
}) {
  const data = await (async () => {
    try {
      return await getMessagingAnalytics(tenantId, range);
    } catch (e) {
      console.warn('[analytics:team] métricas de mensajería no disponibles', {
        err: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  })();

  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="inline-flex items-center rounded-full border border-[--color-border] bg-white p-1 text-xs">
          <RangePill
            href="/dashboard/analytics?tab=team&range=today"
            active={range === 'today'}
            label="Hoy"
          />
          <RangePill
            href="/dashboard/analytics?tab=team&range=7d"
            active={range === '7d'}
            label="7 días"
          />
          <RangePill
            href="/dashboard/analytics?tab=team&range=30d"
            active={range === '30d'}
            label="30 días"
          />
        </div>
      </div>

      <MessagingAnalyticsPanel data={data} />
    </>
  );
}

async function InboundAnalytics({
  tenantId,
  range,
}: {
  tenantId: string;
  range: AnalyticsRange;
}) {
  const result = await (async () => {
    try {
      return { ok: true as const, data: await getAnalytics(tenantId, range) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  if (!result.ok) return <ModuleUnavailable label="entrantes" detail={result.error} />;
  const data = result.data;
  const maxByHour = Math.max(1, ...data.byHour.map((h) => h.calls));

  return (
    <>
      <div className="flex justify-end mb-4">
        <div className="inline-flex items-center rounded-full border border-[--color-border] bg-white p-1 text-xs">
          <RangePill
            href="/dashboard/analytics?tab=inbound&range=today"
            active={range === 'today'}
            label="Hoy"
          />
          <RangePill
            href="/dashboard/analytics?tab=inbound&range=7d"
            active={range === '7d'}
            label="7 días"
          />
          <RangePill
            href="/dashboard/analytics?tab=inbound&range=30d"
            active={range === '30d'}
            label="30 días"
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Total llamadas"
            numeric={data.total}
            hint="Período actual"
            icon={<PhoneCall className="h-4 w-4" />}
            tone="grape"
            trend={data.byHour.length > 1 ? data.byHour.map((h) => h.calls) : undefined}
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="AHT promedio"
            value={formatDuration(data.avgDurationSec)}
            hint="Duración media"
            icon={<Clock className="h-4 w-4" />}
            tone="sky"
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Citas creadas"
            numeric={data.booked}
            hint={
              data.total === 0
                ? 'Sin llamadas en el rango'
                : `${Math.round((data.booked / Math.max(1, data.total)) * 100)}% del total`
            }
            icon={<Calendar className="h-4 w-4" />}
            tone="mint"
            progress={data.total === 0 ? 0 : (data.booked / Math.max(1, data.total)) * 100}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Containment"
            numeric={data.containment}
            suffix="%"
            hint={`${data.transferred} transferidas`}
            icon={<TrendingUp className="h-4 w-4" />}
            tone="blossom"
            progress={data.containment}
          />
        </Reveal>
      </div>

      {data.total === 0 ? (
        <Card>
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="Sin datos en este rango"
            description="Cuando llegue la primera llamada, los gráficos se llenan automáticamente."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {range !== 'today' && (
            <Reveal>
              <Card>
                <CardTopbar
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone="grape"
                  title="Tendencia diaria"
                  subtitle="Llamadas apiladas por intención"
                  action={<Badge tone="violet">{range === '7d' ? '7 días' : '30 días'}</Badge>}
                />
                <div className="px-4 pb-6 sm:px-6">
                  <CallsTrendChart data={data.byDay} />
                </div>
              </Card>
            </Reveal>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
            <Card className="xl:col-span-2">
              <CardTopbar
                icon={<Clock className="h-4 w-4" />}
                tone="sky"
                title="Llamadas por hora"
                subtitle="Distribución del período"
                action={
                  <Badge tone="info">
                    {range === 'today' ? 'Hoy' : range === '7d' ? '7 días' : '30 días'}
                  </Badge>
                }
              />
              <div className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-1 sm:gap-1.5 h-48 sm:h-56 min-w-[540px] sm:min-w-0">
                    {data.byHour.map((h, i) => (
                      <div
                        key={h.hour}
                        className="group/bar flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:gap-2"
                      >
                        <div
                          className="min-h-[3px] w-full origin-bottom rounded-t-lg bg-[linear-gradient(180deg,#6bc2a4,#37766a)] transition-[filter,transform] duration-300 hover:brightness-110 group-hover/bar:scale-x-110"
                          style={{
                            height: `${(h.calls / maxByHour) * 100}%`,
                            animation: 'grow-y 700ms cubic-bezier(0.22,1,0.36,1) both',
                            animationDelay: `${i * 22}ms`,
                          }}
                          title={`${h.hour}:00 — ${h.calls} llamadas`}
                        />
                        <span className="text-[9px] tabular-nums text-zinc-400 sm:text-[10px]">
                          {h.hour.toString().padStart(2, '0')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardTopbar
                icon={<BarChart3 className="h-4 w-4" />}
                tone="blossom"
                title="Por intención"
                subtitle="Distribución del período"
              />
              <div className="px-4 pb-5 sm:px-6 sm:pb-6">
                <IntentDonut data={data.intents} />
                <div className="mt-4 border-t border-[--color-border-subtle] pt-4">
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
      className={`rounded-full px-3.5 py-2 font-semibold transition-all duration-300 ${
        active
          ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_6px_18px_-8px_rgba(55,118,106,0.8)]'
          : 'text-zinc-500 hover:bg-zinc-100 hover:text-brand-700'
      }`}
    >
      {label}
    </Link>
  );
}
