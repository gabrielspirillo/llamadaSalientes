import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCircle2, CreditCard, Download } from 'lucide-react';

const invoices = [
  { id: 'INV-2026-005', date: '01 May 2026', amount: '$299.00', status: 'paid' },
  { id: 'INV-2026-004', date: '01 Apr 2026', amount: '$299.00', status: 'paid' },
  { id: 'INV-2026-003', date: '01 Mar 2026', amount: '$299.00', status: 'paid' },
  { id: 'INV-2026-002', date: '01 Feb 2026', amount: '$149.00', status: 'paid' },
];

export default function BillingPage() {
  return (
    <>
      <PageHeader title="Facturación" description="Plan, consumo y facturas de Clínica Demo." />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Plan */}
        <Card className="lg:col-span-2">
          <div className="p-6">
            <div className="flex items-center justify-between mb-1">
              <Badge tone="info">Plan actual</Badge>
              <Badge tone="success">
                <CheckCircle2 className="h-3 w-3" /> Activo
              </Badge>
            </div>
            <h3 className="text-3xl font-semibold tracking-tight mt-3">Pro</h3>
            <p className="text-zinc-500 mt-1">$299 / mes · Renueva el 1 jun 2026</p>

            <div className="mt-6">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-zinc-500">Minutos usados este mes</span>
                <span className="font-medium tabular-nums">387 / 600 min</span>
              </div>
              <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div className="h-full w-[64%] rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400" />
              </div>
              <p className="text-xs text-zinc-400 mt-2">213 min restantes · Overage $0.20/min</p>
            </div>

            <div className="mt-7 flex items-center gap-2">
              <Button>Cambiar plan</Button>
              <Button variant="secondary">
                <CreditCard className="h-4 w-4" /> Portal de cliente
              </Button>
            </div>
          </div>
        </Card>

        {/* Payment method */}
        <Card>
          <div className="p-6">
            <h3 className="text-base font-semibold tracking-tight">Método de pago</h3>
            <div className="mt-4 rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
              <div className="h-10 w-14 rounded-md bg-gradient-to-br from-zinc-900 to-zinc-700 text-white flex items-center justify-center text-xs font-semibold">
                VISA
              </div>
              <div>
                <p className="text-sm font-medium">•••• 4242</p>
                <p className="text-xs text-zinc-500">Expira 09/27</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" className="w-full mt-4">
              Cambiar tarjeta
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between p-6 pb-4">
          <h3 className="text-base font-semibold tracking-tight">Facturas</h3>
          <Button variant="ghost" size="sm">
            <Download className="h-4 w-4" /> Descargar todas
          </Button>
        </div>
        <div className="border-t border-zinc-100 divide-y divide-zinc-100">
          {invoices.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between p-5 hover:bg-zinc-50/60 transition-colors"
            >
              <div>
                <p className="font-medium font-mono text-sm">{i.id}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{i.date}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="tabular-nums font-medium">{i.amount}</span>
                <Badge tone="success">Pagada</Badge>
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
