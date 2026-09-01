import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/feedback';
import { SearchX } from 'lucide-react';
import Link from 'next/link';

/**
 * 404 dentro del chrome del panel. Las rutas con [id] llaman a notFound()
 * cuando el registro no existe o es de otra clínica; sin esto caían en el 404
 * pelado de Next, fuera del layout y sin forma de volver al listado.
 */
export default function DashboardNotFound() {
  return (
    <Card>
      <EmptyState
        icon={<SearchX className="h-6 w-6" />}
        title="No encontramos esto"
        description="El registro no existe o ya no está disponible para tu clínica."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">Volver al panel</Link>
          </Button>
        }
      />
    </Card>
  );
}
