import { OutboundQuickCall } from '@/components/dashboard/outbound-quick-call';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { USE_CASE_LABEL, type UseCase, listCampaigns } from '@/lib/data/outbound-campaigns';
import { getCurrentTenant } from '@/lib/tenant';
import { ArrowRight, PhoneOutgoing, Plus } from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function statusBadge(status: string) {
  switch (status) {
    case 'draft':
      return <Badge>Borrador</Badge>;
    case 'running':
      return <Badge tone="info">En curso</Badge>;
    case 'completed':
      return <Badge tone="success">Completada</Badge>;
    case 'failed':
      return <Badge tone="danger">Error</Badge>;
    case 'paused':
      return <Badge tone="warn">Pausada</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

export default async function OutboundPage() {
  const { tenant } = await getCurrentTenant();
  const campaigns = await listCampaigns(tenant.id);

  return (
    <div>
      <PageHeader
        title="Llamadas salientes"
        description="Campañas de cobranza, recordatorios y reactivación con tu agente outbound."
        actions={
          <Button asChild>
            <Link href="/dashboard/outbound/new">
              <Plus className="h-4 w-4" />
              Nueva campaña
            </Link>
          </Button>
        }
      />

      <OutboundQuickCall />

      <div className="flex items-center justify-between mb-3 mt-2">
        <h2 className="text-sm font-medium text-zinc-700">Campañas</h2>
      </div>

      {campaigns.length === 0 ? (
        <Card className="p-10 text-center">
          <PhoneOutgoing className="mx-auto h-8 w-8 text-zinc-300" />
          <p className="mt-3 text-sm font-medium">No tenés campañas todavía</p>
          <p className="mt-1 text-sm text-zinc-500">
            Subí un CSV con los teléfonos a llamar y elegí el caso de uso.
          </p>
          <div className="mt-5">
            <Button asChild>
              <Link href="/dashboard/outbound/new">Crear primera campaña</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-zinc-500 border-b border-zinc-100">
              <tr>
                <th className="text-left font-medium px-5 py-3">Campaña</th>
                <th className="text-left font-medium px-5 py-3">Caso de uso</th>
                <th className="text-left font-medium px-5 py-3">Estado</th>
                <th className="text-right font-medium px-5 py-3">Progreso</th>
                <th className="text-right font-medium px-5 py-3">Creada</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-zinc-50 last:border-0">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-5 py-3 text-zinc-600">
                    {USE_CASE_LABEL[c.useCase as UseCase] ?? c.useCase}
                  </td>
                  <td className="px-5 py-3">{statusBadge(c.status)}</td>
                  <td className="px-5 py-3 text-right text-zinc-600 tabular-nums">
                    {c.completedTargets}/{c.totalTargets}
                  </td>
                  <td className="px-5 py-3 text-right text-zinc-500 text-xs">
                    {new Date(c.createdAt).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/outbound/${c.id}`}
                      className="text-violet-600 hover:text-violet-700 inline-flex items-center gap-1 text-xs font-medium"
                    >
                      Ver <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
