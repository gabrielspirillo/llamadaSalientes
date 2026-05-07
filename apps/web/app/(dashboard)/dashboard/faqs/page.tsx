import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { mockFaqs } from '@/lib/mock-data';
import { Plus, Search } from 'lucide-react';

export default function FaqsPage() {
  return (
    <>
      <PageHeader
        title="Preguntas frecuentes"
        description="Respuestas que el agente puede dar sin consultar GHL."
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" /> Nueva FAQ
          </Button>
        }
      />

      <div className="mb-5 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
        <Input placeholder="Buscar pregunta o respuesta..." className="pl-9" />
      </div>

      <div className="space-y-3">
        {mockFaqs.map((f) => (
          <Card key={f.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Badge>{f.category}</Badge>
                  <span className="text-xs text-zinc-400">prioridad {f.priority}</span>
                </div>
                <h3 className="font-medium">{f.question}</h3>
                <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed">{f.answer}</p>
              </div>
              <Button variant="ghost" size="sm">
                Editar
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
