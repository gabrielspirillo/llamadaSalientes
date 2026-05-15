import { OutboundDispatchButton } from '@/components/dashboard/outbound-dispatch-button';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  USE_CASE_LABEL,
  type UseCase,
  getCampaign,
  getCampaignTargets,
} from '@/lib/data/outbound-campaigns';
import { getCurrentTenant } from '@/lib/tenant';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

function targetStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge>Pendiente</Badge>;
    case 'queued':
      return <Badge tone="info">En cola</Badge>;
    case 'ongoing':
      return <Badge tone="info">En curso</Badge>;
    case 'ended':
      return <Badge tone="success">Contactado</Badge>;
    case 'voicemail':
      return <Badge tone="warn">Buzón</Badge>;
    case 'no_answer':
      return <Badge tone="warn">No atendió</Badge>;
    case 'busy':
      return <Badge tone="warn">Ocupado</Badge>;
    case 'failed':
      return <Badge tone="danger">Error</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export default async function OutboundCampaignDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { tenant } = await getCurrentTenant();
  const campaign = await getCampaign(tenant.id, id);
  if (!campaign) notFound();

  const targets = await getCampaignTargets(tenant.id, id);
  const pendingCount = targets.filter((t) => t.status === 'pending').length;

  const summary = {
    total: targets.length,
    pending: targets.filter((t) => t.status === 'pending').length,
    ongoing: targets.filter((t) => t.status === 'ongoing' || t.status === 'queued').length,
    completed: targets.filter((t) => t.status === 'ended').length,
    voicemail: targets.filter((t) => t.status === 'voicemail').length,
    failed: targets.filter((t) => ['failed', 'no_answer', 'busy'].includes(t.status)).length,
  };

  return (
    <div>
      <PageHeader
        title={campaign.name}
        description={`${USE_CASE_LABEL[campaign.useCase as UseCase] ?? campaign.useCase} · ${summary.total} destinatarios`}
        actions={
          campaign.status === 'draft' ? (
            <OutboundDispatchButton campaignId={campaign.id} disabled={pendingCount === 0} />
          ) : (
            <Badge tone={campaign.status === 'running' ? 'info' : 'success'}>
              {campaign.status}
            </Badge>
          )
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Stat label="Total" value={summary.total} />
        <Stat label="Pendientes" value={summary.pending} />
        <Stat label="En curso" value={summary.ongoing} />
        <Stat label="Contactados" value={summary.completed} tone="success" />
        <Stat label="Buzón" value={summary.voicemail} tone="warn" />
        <Stat label="Fallidos" value={summary.failed} tone="danger" />
      </div>

      <Card>
        <table className="w-full text-sm">
          <thead className="text-zinc-500 border-b border-zinc-100">
            <tr>
              <th className="text-left font-medium px-5 py-3">Teléfono</th>
              <th className="text-left font-medium px-5 py-3">Nombre</th>
              <th className="text-left font-medium px-5 py-3">Estado</th>
              <th className="text-left font-medium px-5 py-3">Razón</th>
              <th className="text-right font-medium px-5 py-3">Último intento</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id} className="border-b border-zinc-50 last:border-0">
                <td className="px-5 py-3 font-mono text-xs">{t.toNumber}</td>
                <td className="px-5 py-3">{t.patientName ?? '—'}</td>
                <td className="px-5 py-3">{targetStatusBadge(t.status)}</td>
                <td className="px-5 py-3 text-xs text-zinc-500">
                  {t.lastDisconnectionReason ?? t.lastError ?? '—'}
                </td>
                <td className="px-5 py-3 text-right text-xs text-zinc-500">
                  {t.lastAttemptAt ? new Date(t.lastAttemptAt).toLocaleString('es-AR') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warn' | 'danger';
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-600'
      : tone === 'warn'
        ? 'text-amber-600'
        : tone === 'danger'
          ? 'text-red-600'
          : 'text-zinc-900';
  return (
    <Card className="p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}
