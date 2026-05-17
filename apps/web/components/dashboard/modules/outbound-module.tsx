import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, PhoneOutgoing } from 'lucide-react';
import Link from 'next/link';

export function OutboundModule() {
  return (
    <Card>
      <div className="px-6 py-16 text-center max-w-md mx-auto">
        <div className="h-12 w-12 inline-flex items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 mb-4">
          <PhoneOutgoing className="h-5 w-5" />
        </div>
        <p className="text-base font-semibold tracking-tight">Llamadas salientes</p>
        <p className="text-sm text-zinc-500 mt-1.5">
          Métricas de campañas (contact rate, completion, revenue recuperado por canal)
          aparecerán acá una vez se conecten los datos.
        </p>
        <Button asChild variant="secondary" size="sm" className="mt-5">
          <Link href="/dashboard/outbound">
            Ir a campañas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
