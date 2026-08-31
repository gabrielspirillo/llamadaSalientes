'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

// Evita el crash de página completa: si una métrica falla, mostramos un estado
// claro con opción de reintentar en vez del error crudo de Next.
export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[analytics] render error', error);
  }, [error]);

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-zinc-600">
          No pudimos cargar las métricas en este momento.
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          <RotateCcw className="h-4 w-4" /> Reintentar
        </Button>
      </div>
    </Card>
  );
}
