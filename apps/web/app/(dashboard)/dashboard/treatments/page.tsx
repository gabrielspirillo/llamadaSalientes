import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
        title="Tratamientos"
        description="Catálogo que el agente conoce y puede ofrecer."
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
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                  <th className="px-5 py-3 font-medium">Nombre</th>
                  <th className="px-5 py-3 font-medium">Duración</th>
                  <th className="px-5 py-3 font-medium">Precio</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium">{t.name}</div>
                      {t.description && (
                        <div className="text-xs text-zinc-500 mt-0.5 line-clamp-1">
                          {t.description}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-zinc-600 tabular-nums">
                      {t.durationMinutes} min
                    </td>
                    <td className="px-5 py-3.5 text-zinc-700 tabular-nums">
                      {formatPrice(t.priceMin, t.priceMax)}
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge tone={t.active ? 'success' : 'neutral'}>
                        {t.active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function formatPrice(min: string | null, max: string | null) {
  if (!min && !max) return 'Consulta gratuita';
  if (min === max) return `$${min}`;
  return `$${min ?? '—'} – $${max ?? '—'}`;
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center justify-center text-center p-14">
      <div className="h-12 w-12 rounded-2xl bg-zinc-100 inline-flex items-center justify-center mb-4">
        <Stethoscope className="h-6 w-6 text-zinc-500" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">Sin tratamientos todavía</h3>
      <p className="text-sm text-zinc-500 mt-1.5 max-w-sm">
        Cargá tu primer tratamiento para que el agente lo pueda ofrecer y agendar.
      </p>
      <TreatmentDialog
        trigger={
          <Button className="mt-6">
            <Plus className="h-4 w-4" /> Crear el primero
          </Button>
        }
      />
    </Card>
  );
}
