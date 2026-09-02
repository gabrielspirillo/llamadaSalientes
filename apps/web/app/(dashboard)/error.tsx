'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Boundary del panel entero. Sin esto, cualquier fallo de datos en el layout o
 * en una página dejaba la pantalla en blanco con el error crudo de Next: sin
 * sidebar, sin forma de volver.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard] render error', error);
  }, [error]);

  return (
    <Card>
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-[16px] font-semibold tracking-tight text-zinc-800">
          No pudimos cargar esta sección
        </p>
        <p className="max-w-sm text-sm text-zinc-500">
          Fue un problema puntual al traer los datos. Inténtalo de nuevo; si sigue pasando, avísanos.
        </p>
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={reset}>
            <RotateCcw className="h-4 w-4" /> Reintentar
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Ir al inicio</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
