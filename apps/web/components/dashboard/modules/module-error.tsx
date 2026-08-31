import { Card } from '@/components/ui/card';

export function ModuleUnavailable({ label }: { label?: string }) {
  return (
    <Card>
      <div className="p-10 text-center text-sm text-zinc-500">
        No se pudieron cargar las métricas{label ? ` de ${label}` : ''} en este momento.
      </div>
    </Card>
  );
}
