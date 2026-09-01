import { Card } from '@/components/ui/card';
import { Skeleton, SkeletonRows } from '@/components/ui/feedback';

/**
 * Esqueleto genérico de una página del panel. Lo usan los `loading.tsx` de
 * cada segmento: sin ellos, con 17 rutas `force-dynamic`, el navegador se
 * queda con la pantalla anterior durante todo el trabajo de servidor y la app
 * se lee como colgada.
 */
export function PageSkeleton({ rows = 6, tiles = 4 }: { rows?: number; tiles?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>

      {/* Cabecera */}
      <div className="space-y-3">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-7 w-64 rounded-xl" />
      </div>

      {/* Fila de KPIs */}
      {tiles > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => `tile-${i}`).map((id) => (
            <Card key={id}>
              <div className="space-y-3 p-5">
                <Skeleton className="h-3 w-20 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-xl" />
                <Skeleton className="h-2.5 w-32 rounded-full" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Contenido principal */}
      <Card>
        <SkeletonRows rows={rows} />
      </Card>
    </div>
  );
}
