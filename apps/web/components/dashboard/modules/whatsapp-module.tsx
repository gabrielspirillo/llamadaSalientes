import {
  ConversationStatusChart,
  MessagesByHourChart,
} from '@/components/dashboard/analytics-module-charts';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  getConversationStatusBreakdown,
  getMessagesByHour,
  getWhatsappKPIs,
} from '@/lib/data/analytics/whatsapp';
import { ArrowRight, Coins, MessageCircle, UserCog, Users } from 'lucide-react';
import Link from 'next/link';

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

export async function WhatsappModule({ tenantId }: { tenantId: string }) {
  const [kpis, byHour, status] = await Promise.all([
    getWhatsappKPIs(tenantId),
    getMessagesByHour(tenantId),
    getConversationStatusBreakdown(tenantId),
  ]);

  const totalConversations = status.active + status.handoff + status.closed;
  if (totalConversations === 0 && kpis.messagesLast24h === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <KpiCard
          label="Conversaciones activas"
          value={String(kpis.activeConversations)}
          hint={`${totalConversations} totales`}
          icon={<Users className="h-4 w-4" />}
        />
        <KpiCard
          label="Handoff humano"
          value={formatPercent(kpis.handoffRate)}
          hint={`${kpis.handoffConversations} con humano`}
          icon={<UserCog className="h-4 w-4" />}
          tone={kpis.handoffRate > 0.3 ? 'warn' : 'default'}
        />
        <KpiCard
          label="Mensajes (24 h)"
          value={String(kpis.messagesLast24h)}
          hint="Entrantes + salientes"
          icon={<MessageCircle className="h-4 w-4" />}
        />
        <KpiCard
          label="Revenue MTD"
          value={formatMoney(kpis.revenueAttributedCentsMTD)}
          hint={`${kpis.appointmentsBookedMTD} citas atribuidas`}
          icon={<Coins className="h-4 w-4" />}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between p-4 sm:p-5 pb-2">
            <div>
              <h3 className="text-base font-semibold tracking-tight">
                Mensajes últimas 24 h
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">Apilados por dirección</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard/whatsapp">
                Ver conversaciones <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2">
            <MessagesByHourChart data={byHour} />
          </div>
        </Card>

        <Card>
          <div className="p-4 sm:p-5 pb-2">
            <h3 className="text-base font-semibold tracking-tight">Estado de conversaciones</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Distribución total</p>
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-2">
            <ConversationStatusChart data={status} />
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
        <div className="h-12 w-12 inline-flex items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 mb-4">
          <MessageCircle className="h-5 w-5" />
        </div>
        <p className="text-base font-semibold tracking-tight">WhatsApp</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          Cuando se conecte WhatsApp aparecerán conversaciones activas, handoff humano,
          mensajes por hora y revenue atribuido.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href="/dashboard/whatsapp">
            Configurar WhatsApp <ArrowRight className="h-3.5 w-3.5" />
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
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">{label}</p>
        <div className={`h-7 w-7 inline-flex items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
      </div>
      <div className="mt-3">
        <span className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      </div>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  );
}
