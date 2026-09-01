import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';

// Banner siempre visible mientras el dashboard está en modo demo (?demo=1).
// Patrón Stripe: aviso claro de que son datos de ejemplo + salida explícita,
// para no confundirlos nunca con datos reales.
export function DemoBanner() {
  return (
    <div className="relative mb-6 animate-fade-down overflow-hidden rounded-[22px] border border-amber-200/70 bg-[linear-gradient(120deg,#fffaf0_0%,#fdf5e6_45%,#fdf0f7_100%)] p-4 sm:p-5">
      {/* Halo animado — deja claro que es un estado especial, no el panel real */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 animate-float rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.28),transparent_70%)] blur-2xl"
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <Sparkles className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="text-[14px] font-bold tracking-tight text-amber-900">
              Estás viendo datos de ejemplo
            </p>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-amber-800/80">
              Así se verá tu panel cuando el asistente empiece a atender llamadas, dar citas y
              recuperar las que se cancelan.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/configuration?tab=telephony">Conectar mi clínica</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">Salir del modo demo</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
