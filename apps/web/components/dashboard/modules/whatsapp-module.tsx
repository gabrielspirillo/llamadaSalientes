import { ConversationStatusChart, MessagesByHourChart } from '@/components/dashboard/charts-lazy';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { EmptyState as UiEmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { StatTile } from '@/components/ui/stat';
import {
  getConversationStatusBreakdown,
  getMessagesByHour,
  getWhatsappKPIs,
} from '@/lib/data/analytics/whatsapp';
import { ArrowRight, Coins, MessageCircle, PieChart, UserCog, Users } from 'lucide-react';
import Link from 'next/link';
import { ModuleUnavailable } from './module-error';

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

export async function WhatsappModule({ tenantId }: { tenantId: string }) {
  const result = await (async () => {
    try {
      return {
        ok: true as const,
        data: await Promise.all([
          getWhatsappKPIs(tenantId),
          getMessagesByHour(tenantId),
          getConversationStatusBreakdown(tenantId),
        ]),
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  })();
  if (!result.ok) return <ModuleUnavailable label="WhatsApp" detail={result.error} />;
  const [kpis, byHour, status] = result.data;

  const totalConversations = status.active + status.handoff + status.closed;
  if (totalConversations === 0 && kpis.messagesLast24h === 0) {
    return <WhatsappEmpty />;
  }

  const hourTrend = byHour.slice(-12).map((h) => h.inbound + h.outbound);

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Reveal delay={0}>
          <StatTile
            label="Conversaciones activas"
            numeric={kpis.activeConversations}
            hint={`${totalConversations} totales`}
            icon={<Users className="h-4 w-4" />}
            tone="mint"
          />
        </Reveal>
        <Reveal delay={70}>
          <StatTile
            label="Handoff humano"
            numeric={kpis.handoffRate * 100}
            suffix="%"
            hint={`${kpis.handoffConversations} con humano`}
            icon={<UserCog className="h-4 w-4" />}
            tone={kpis.handoffRate > 0.3 ? 'honey' : 'sky'}
            progress={kpis.handoffRate * 100}
          />
        </Reveal>
        <Reveal delay={140}>
          <StatTile
            label="Mensajes (24 h)"
            numeric={kpis.messagesLast24h}
            hint="Entrantes + salientes"
            icon={<MessageCircle className="h-4 w-4" />}
            tone="grape"
            trend={hourTrend.length > 1 ? hourTrend : undefined}
          />
        </Reveal>
        <Reveal delay={210}>
          <StatTile
            label="Revenue MTD"
            value={formatMoney(kpis.revenueAttributedCentsMTD)}
            hint={`${kpis.appointmentsBookedMTD} citas atribuidas`}
            icon={<Coins className="h-4 w-4" />}
            tone="blossom"
          />
        </Reveal>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        <Reveal direction="left" className="xl:col-span-2">
          <Card className="group h-full">
            <CardTopbar
              icon={<MessageCircle className="h-4 w-4" />}
              tone="mint"
              title="Mensajes últimas 24 h"
              subtitle="Apilados por dirección"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/whatsapp">
                    Ver conversaciones
                    <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </Button>
              }
            />
            <div className="px-4 pb-5 sm:px-5">
              <MessagesByHourChart data={byHour} />
            </div>
          </Card>
        </Reveal>

        <Reveal direction="right">
          <Card className="h-full">
            <CardTopbar
              icon={<PieChart className="h-4 w-4" />}
              tone="sky"
              title="Estado de conversaciones"
              subtitle="Distribución total"
            />
            <div className="px-4 pb-5 sm:px-5">
              <ConversationStatusChart data={status} />
            </div>
          </Card>
        </Reveal>
      </div>
    </>
  );
}

function WhatsappEmpty() {
  return (
    <Card>
      <UiEmptyState
        icon={<MessageCircle className="h-5 w-5" />}
        title="WhatsApp todavía sin actividad"
        description="Cuando se conecte el número vas a ver conversaciones activas, handoff humano, mensajes por hora y revenue atribuido."
        action={
          <Button asChild size="sm">
            <Link href="/dashboard/whatsapp">
              Configurar WhatsApp <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      />
    </Card>
  );
}
