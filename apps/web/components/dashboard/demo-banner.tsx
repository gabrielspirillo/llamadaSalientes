import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';

// Banner siempre visible mientras el dashboard está en modo demo (?demo=1).
// Patrón Stripe: aviso claro de que son datos de ejemplo + salida explícita,
// para no confundirlos nunca con datos reales.
export function DemoBanner() {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-amber-900">Estás viendo datos de ejemplo</p>
          <p className="mt-0.5 text-sm text-amber-800/80">
            Así se verá tu panel cuando el agente empiece a atender llamadas, agendar turnos y
            recuperar cancelaciones para tu clínica.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href="/dashboard/configuration?tab=telephony">Conectar mi clínica</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">Salir del demo</Link>
        </Button>
      </div>
    </div>
  );
}
