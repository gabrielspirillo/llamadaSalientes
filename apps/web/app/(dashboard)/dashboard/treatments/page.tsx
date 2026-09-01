import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState as UiEmptyState } from '@/components/ui/feedback';
import { Reveal } from '@/components/ui/motion';
import { HeadRow, TD, TH, TR, Table, TableWrap, THead } from '@/components/ui/table';
import { listTreatmentsForTenant } from '@/lib/data/treatments';
import { getCurrentTenant } from '@/lib/tenant';
import { Plus, Stethoscope } from 'lucide-react';
import { DeleteTreatmentButton } from './delete-button';
import { TreatmentDialog } from './treatment-dialog';

export default async function TreatmentsPage() {
  const { tenant } = await getCurrentTenant();
  const rows = await listTreatmentsForTenant(tenant.id);

  return (
    <>
      <PageHeader
        eyebrow="Catálogo"
        icon={<Stethoscope className="h-5 w-5" />}
        title="Tratamientos"
        description="Catálogo que el agente conoce y puede ofrecer a los pacientes."
        actions={
          <TreatmentDialog
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" /> Nuevo tratamiento
              </Button>
            }
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <Reveal>
        <Card className="overflow-hidden">
          {/* Mobile: cards */}
          <ul className="stagger divide-y divide-[--color-border-subtle] md:hidden">
            {rows.map((t, i) => (
              <li key={t.id} className="p-4" style={{ ['--i' as string]: Math.min(i, 12) }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-zinc-900">{t.name}</p>
                    {t.description && (
                      <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">
                        {t.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                      <span className="tabular-nums">{t.durationMinutes} min</span>
                      <span className="tabular-nums">{formatPrice(t.priceMin, t.priceMax)}</span>
                      <Badge tone={t.active ? 'success' : 'neutral'}>
                        {t.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <TreatmentDialog
                      treatment={t}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Editar
                        </Button>
                      }
                    />
                    <DeleteTreatmentButton id={t.id} name={t.name} />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block">
            <TableWrap>
              <Table>
                <THead>
                  <HeadRow>
                    <TH>Nombre</TH>
                    <TH>Duración</TH>
                    <TH>Precio</TH>
                    <TH>Estado</TH>
                    <TH />
                  </HeadRow>
                </THead>
                <tbody>
                {rows.map((t) => (
                  <TR key={t.id}>
                    <TD>
                      <div className="text-[14px] font-bold text-zinc-900">{t.name}</div>
                      {t.description && (
                        <div className="mt-0.5 line-clamp-1 text-[12px] text-zinc-500">
                          {t.description}
                        </div>
                      )}
                    </TD>
                    <TD className="tabular-nums text-zinc-600">{t.durationMinutes} min</TD>
                    <TD className="tabular-nums">
                      <span className="font-semibold text-zinc-800">
                        {formatPrice(t.priceMin, t.priceMax)}
                      </span>
                      {t.priceCents != null && (
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          {(t.priceCents / 100).toFixed(0)} € · revenue
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={t.active ? 'success' : 'neutral'}>
                        {t.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <TreatmentDialog
                          treatment={t}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Editar
                            </Button>
                          }
                        />
                        <DeleteTreatmentButton id={t.id} name={t.name} />
                      </div>
                    </TD>
                  </TR>
                ))}
                </tbody>
              </Table>
            </TableWrap>
          </div>
        </Card>
        </Reveal>
      )}
    </>
  );
}

function formatPrice(min: string | null, max: string | null) {
  if (!min && !max) return 'Consulta gratuita';
  if (min === max) return `${min} €`;
  return `${min ?? '—'} € – ${max ?? '—'} €`;
}

function EmptyState() {
  return (
    <Card>
      <UiEmptyState
        icon={<Stethoscope className="h-5 w-5" />}
        title="Sin tratamientos todavía"
        description="Cargá tu primer tratamiento para que el agente lo pueda ofrecer y agendar."
        action={
          <TreatmentDialog
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> Crear el primero
              </Button>
            }
          />
        }
      />
    </Card>
  );
}
