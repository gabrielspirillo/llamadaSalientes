import { OutboundQuickCall } from '@/components/dashboard/outbound-quick-call';
import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, SectionTitle } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { ProgressBar } from '@/components/ui/stat';
import { HeadRow, TD, TH, TR, Table, TableWrap, THead } from '@/components/ui/table';
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
        eyebrow="Canal saliente"
        icon={<PhoneOutgoing className="h-5 w-5" />}
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

      <SectionTitle title="Campañas" className="mt-6" />

      {campaigns.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PhoneOutgoing className="h-5 w-5" />}
            title="No tenés campañas todavía"
            description="Subí un CSV con los teléfonos a llamar y elegí el caso de uso."
            action={
              <Button asChild>
                <Link href="/dashboard/outbound/new">
                  <Plus className="h-4 w-4" /> Crear primera campaña
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Reveal>
        <Card className="overflow-hidden">
          {/* Mobile: cards */}
          <ul className="stagger divide-y divide-[--color-border-subtle] md:hidden">
            {campaigns.map((c, i) => (
              <li key={c.id} style={{ ['--i' as string]: Math.min(i, 12) }}>
                <Link
                  href={`/dashboard/outbound/${c.id}`}
                  className="flex items-start gap-3 p-4 hover:bg-brand-50/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-bold text-zinc-900">{c.name}</p>
                      <span className="text-[11px] text-zinc-400 shrink-0">
                        {new Date(c.createdAt).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {USE_CASE_LABEL[c.useCase as UseCase] ?? c.useCase}
                    </p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {statusBadge(c.status)}
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {c.completedTargets}/{c.totalTargets}
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-300 shrink-0 mt-1.5" />
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet/Desktop: table */}
          <div className="hidden md:block">
            <TableWrap>
              <Table>
                <THead>
                  <HeadRow>
                    <TH>Campaña</TH>
                    <TH className="hidden lg:table-cell">Caso de uso</TH>
                    <TH>Estado</TH>
                    <TH className="w-48">Progreso</TH>
                    <TH className="hidden text-right lg:table-cell">Creada</TH>
                    <TH />
                  </HeadRow>
                </THead>
                <tbody>
                  {campaigns.map((c) => {
                    const pct =
                      c.totalTargets > 0 ? (c.completedTargets / c.totalTargets) * 100 : 0;
                    return (
                      <TR key={c.id} className="group">
                        <TD className="text-[14px] font-bold text-zinc-900">{c.name}</TD>
                        <TD className="hidden text-zinc-600 lg:table-cell">
                          {USE_CASE_LABEL[c.useCase as UseCase] ?? c.useCase}
                        </TD>
                        <TD>{statusBadge(c.status)}</TD>
                        <TD>
                          <div className="flex items-center gap-2.5">
                            <ProgressBar value={pct} tone="blossom" className="min-w-[80px]" />
                            <span className="shrink-0 text-[12px] font-semibold tabular-nums text-zinc-600">
                              {c.completedTargets}/{c.totalTargets}
                            </span>
                          </div>
                        </TD>
                        <TD className="hidden text-right text-[12px] text-zinc-500 lg:table-cell">
                          {new Date(c.createdAt).toLocaleDateString('es-AR')}
                        </TD>
                        <TD className="text-right">
                          <Link
                            href={`/dashboard/outbound/${c.id}`}
                            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-brand-600 transition-all duration-300 group-hover:bg-brand-100 group-hover:text-brand-700"
                          >
                            Ver
                            <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-0.5" />
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </Card>
        </Reveal>
      )}
    </div>
  );
}
