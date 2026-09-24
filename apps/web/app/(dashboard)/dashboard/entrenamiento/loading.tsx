import { Card } from '@/components/ui/card';
import { Skeleton, SkeletonRows } from '@/components/ui/feedback';

/**
 * Sin esto el navegador se queda en la pantalla anterior mientras el servidor
 * carga: la página es `force-dynamic` y lee base en cada visita.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-9 w-full max-w-md rounded-full" />
      <Card className="p-5">
        <SkeletonRows rows={6} />
      </Card>
    </div>
  );
}
