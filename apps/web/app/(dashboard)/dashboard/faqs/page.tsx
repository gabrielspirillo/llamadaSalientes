import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { listFaqsForTenant } from '@/lib/data/faqs';
import { getCurrentTenant } from '@/lib/tenant';
import { HelpCircle, Plus } from 'lucide-react';
import { DeleteFaqButton } from './delete-button';
import { FaqDialog } from './faq-dialog';

export default async function FaqsPage() {
  const { tenant } = await getCurrentTenant();
  const rows = await listFaqsForTenant(tenant.id);

  return (
    <>
      <PageHeader
        title="Preguntas frecuentes"
        description="Respuestas que el agente puede dar sin consultar GHL."
        actions={
          <FaqDialog
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" /> Nueva FAQ
              </Button>
            }
          />
        }
      />

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center justify-center text-center p-14">
          <div className="h-12 w-12 rounded-2xl bg-zinc-100 inline-flex items-center justify-center mb-4">
            <HelpCircle className="h-6 w-6 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold tracking-tight">Sin FAQs todavía</h3>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-sm">
            Cargá las preguntas más comunes (precios, horarios, formas de pago) para que el agente
            responda al toque.
          </p>
          <FaqDialog
            trigger={
              <Button className="mt-6">
                <Plus className="h-4 w-4" /> Crear la primera
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => (
            <Card key={f.id} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {f.category && <Badge>{f.category}</Badge>}
                    <span className="text-xs text-zinc-400">prioridad {f.priority ?? 0}</span>
                  </div>
                  <h3 className="font-medium">{f.question}</h3>
                  <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed">{f.answer}</p>
                </div>
                <div className="flex items-center gap-1">
                  <FaqDialog
                    faq={f}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Editar
                      </Button>
                    }
                  />
                  <DeleteFaqButton id={f.id} question={f.question} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
