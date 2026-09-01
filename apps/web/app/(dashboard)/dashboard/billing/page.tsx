import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { Reveal } from '@/components/ui/motion';
import { ProgressRing } from '@/components/ui/stat';
import { CheckCircle2, CreditCard, Download, Receipt, Wallet } from 'lucide-react';

const invoices = [
  { id: 'INV-2026-005', date: '01 May 2026', amount: '299,00 €', status: 'paid' },
  { id: 'INV-2026-004', date: '01 Apr 2026', amount: '299,00 €', status: 'paid' },
  { id: 'INV-2026-003', date: '01 Mar 2026', amount: '299,00 €', status: 'paid' },
  { id: 'INV-2026-002', date: '01 Feb 2026', amount: '149,00 €', status: 'paid' },
];

export default function BillingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cuenta"
        icon={<Wallet className="h-5 w-5" />}
        title="Facturación"
        description="Tu plan, el consumo del mes y el historial de facturas."
        demoBadge
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        {/* Plan */}
        <Reveal direction="left" className="lg:col-span-2">
          <Card tone="night" className="h-full overflow-hidden p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 animate-float rounded-full bg-[radial-gradient(circle,rgba(95,168,150,0.55),transparent_70%)] blur-3xl"
            />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold text-white/90 ring-1 ring-inset ring-white/15">
                    Plan actual
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-3 py-1 text-[13px] font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Activo
                  </span>
                </div>
                <h3 className="mt-4 text-[41px] font-extrabold leading-none tracking-tight">Pro</h3>
                <p className="mt-2 text-[16px] text-white/60">
                  299 € / mes · Renueva el 1 jun 2026
                </p>

                <div className="mt-6 max-w-sm">
                  <div className="mb-2 flex items-center justify-between text-[16px]">
                    <span className="text-white/60">Minutos usados este mes</span>
                    <span className="font-bold tabular-nums">387 / 600 min</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="bar-fill h-full w-[64%] rounded-full bg-[linear-gradient(90deg,#34d399,#a7f3d0)]" />
                  </div>
                  <p className="mt-2 text-[13px] text-white/50">
                    Quedan 213 min · Cada minuto extra, 0,20 €
                  </p>
                </div>

                <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button variant="glass">Cambiar plan</Button>
                  <Button
                    variant="ghost"
                    className="text-white/80 hover:bg-white/10 hover:text-white"
                  >
                    <CreditCard className="h-4 w-4" /> Portal de cliente
                  </Button>
                </div>
              </div>

              <div className="shrink-0 self-center sm:self-start">
                <ProgressRing value={64} size={104} stroke={9} tone="mint" label="64%" />
              </div>
            </div>
          </Card>
        </Reveal>

        {/* Payment method */}
        <Reveal direction="right">
          <Card className="h-full">
            <CardTopbar
              icon={<CreditCard className="h-4 w-4" />}
              tone="grape"
              title="Método de pago"
              subtitle="Tarjeta asociada a la suscripción"
            />
            <div className="px-5 pb-5 sm:px-6 sm:pb-6">
              <div className="flex items-center gap-3 rounded-2xl border border-[--color-border] bg-[#fafbfb] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]">
                <div className="flex h-10 w-14 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#37766a,#5fa896)] text-[13px] font-bold tracking-wide text-white">
                  VISA
                </div>
                <div>
                  <p className="text-[17px] font-bold tabular-nums text-zinc-900">•••• 4242</p>
                  <p className="text-[14px] text-zinc-500">Expira 09/27</p>
                </div>
              </div>
              <Button variant="secondary" size="sm" className="mt-4 w-full">
                Cambiar tarjeta
              </Button>
            </div>
          </Card>
        </Reveal>
      </div>

      <Card>
        <CardTopbar
          icon={<Receipt className="h-4 w-4" />}
          tone="sky"
          title="Facturas"
          subtitle="Historial de pagos"
          action={
            <Button variant="ghost" size="sm">
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Descargar todas</span>
            </Button>
          }
        />
        <div className="border-t border-[--color-border-subtle] divide-y divide-[--color-border-subtle]">
          {invoices.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 p-4 sm:p-5 hover:bg-zinc-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[16px] font-bold text-zinc-900">{i.id}</p>
                <p className="mt-0.5 text-[14px] text-zinc-500">{i.date}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                <span className="text-[16px] font-bold tabular-nums text-zinc-800">{i.amount}</span>
                <Badge tone="success" className="hidden sm:inline-flex">
                  Pagada
                </Badge>
                <Button variant="ghost" size="icon">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
