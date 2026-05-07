import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { mockTreatments } from '@/lib/mock-data';
import { Plus } from 'lucide-react';

export default function TreatmentsPage() {
  return (
    <>
      <PageHeader
        title="Tratamientos"
        description="Catálogo que el agente conoce y puede ofrecer."
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" /> Nuevo tratamiento
          </Button>
        }
      />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-100">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Duración</th>
                <th className="px-5 py-3 font-medium">Precio</th>
                <th className="px-5 py-3 font-medium">Calendario GHL</th>
                <th className="px-5 py-3 font-medium">Estado</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {mockTreatments.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-zinc-50 last:border-b-0 hover:bg-zinc-50/60"
                >
                  <td className="px-5 py-3.5 font-medium">{t.name}</td>
                  <td className="px-5 py-3.5 text-zinc-600 tabular-nums">{t.duration} min</td>
                  <td className="px-5 py-3.5 text-zinc-700 tabular-nums">
                    {t.priceMin === 0 && t.priceMax === 0
                      ? 'Consulta gratuita'
                      : t.priceMin === t.priceMax
                        ? `$${t.priceMin}`
                        : `$${t.priceMin} – $${t.priceMax}`}
                  </td>
                  <td className="px-5 py-3.5 text-zinc-600">{t.ghlCalendar}</td>
                  <td className="px-5 py-3.5">
                    <Badge tone={t.active ? 'success' : 'neutral'}>
                      {t.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Button variant="ghost" size="sm">
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
