import { Card } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

// `detail` muestra el mensaje de error real (visible solo para quien ve el
// panel, típicamente Futura). Ayuda a diagnosticar sin acceder a los logs.
export function ModuleUnavailable({ label, detail }: { label?: string; detail?: string }) {
  return (
    <Card className="animate-fade-up">
      <div className="p-8 text-center">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="text-[15px] font-semibold text-zinc-800">
          No se pudieron cargar las métricas{label ? ` de ${label}` : ''}
        </p>
        <p className="mt-1 text-[14px] text-zinc-500">Reintentá en unos segundos.</p>
        {detail && (
          <code className="mt-4 inline-block max-w-full break-all rounded-xl bg-rose-50 px-3 py-2 text-left text-[12px] text-rose-700 ring-1 ring-inset ring-rose-100">
            {detail}
          </code>
        )}
      </div>
    </Card>
  );
}
