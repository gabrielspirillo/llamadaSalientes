import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { Stagger } from '@/components/ui/motion';
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
        eyebrow="Base de conocimiento"
        icon={<HelpCircle className="h-5 w-5" />}
        title="Preguntas frecuentes"
        description="Respuestas que el agente da al momento, sin consultar el CRM."
        actions={
          <FaqDialog
            trigger={
              <Button size="sm">
                <Plus className="h-4 w-4" /> Nueva pregunta
              </Button>
            }
          />
        }
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<HelpCircle className="h-5 w-5" />}
            title="Aún no hay preguntas"
            description="Añade las preguntas más habituales (precios, horarios, formas de pago) para que el agente las responda al instante."
            action={
              <FaqDialog
                trigger={
                  <Button>
                    <Plus className="h-4 w-4" /> Crear la primera
                  </Button>
                }
              />
            }
          />
        </Card>
      ) : (
        <Stagger className="space-y-3">
          {rows.map((f) => (
            <Card key={f.id} interactive className="group p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {f.category && <Badge tone="accent">{f.category}</Badge>}
                    <span className="text-[12px] font-medium text-zinc-400">
                      prioridad {f.priority ?? 0}
                    </span>
                  </div>
                  <h3 className="text-[16px] font-bold tracking-tight text-zinc-900">
                    {f.question}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-zinc-600">{f.answer}</p>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-start shrink-0">
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
        </Stagger>
      )}
    </>
  );
}
