import { Card } from '@/components/ui/card';

// `detail` muestra el mensaje de error real (visible solo para quien ve el
// panel, típicamente Futura). Ayuda a diagnosticar sin acceder a los logs.
export function ModuleUnavailable({ label, detail }: { label?: string; detail?: string }) {
  return (
    <Card>
      <div className="p-8 text-center">
        <p className="text-sm text-zinc-500">
          No se pudieron cargar las métricas{label ? ` de ${label}` : ''} en este momento.
        </p>
        {detail && (
          <code className="mt-3 inline-block max-w-full break-all rounded bg-red-50 px-2 py-1 text-left text-xs text-red-700 ring-1 ring-inset ring-red-200">
            {detail}
          </code>
        )}
      </div>
    </Card>
  );
}
