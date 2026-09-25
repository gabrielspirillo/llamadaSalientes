'use client';

import {
  sendInvoiceWhatsappAction,
  voidInvoiceAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { PaymentMethod } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  INVOICE_PAYMENT_METHOD_LABELS,
  buildInvoiceMailto,
  formatCents,
} from '@/lib/invoices/model';
import {
  AlertTriangle,
  Ban,
  Check,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  type InvoiceCandidateView,
  InvoiceDialog,
  type InvoiceDialogProps,
} from './invoice-dialog';

export interface InvoiceListItem {
  id: string;
  number: string;
  /** "16 abr 2026" */
  issuedOnLabel: string;
  totalCents: number;
  status: 'ISSUED' | 'VOID';
  billToName: string;
  billToPhone: string | null;
  billToEmail: string | null;
  paymentMethod: PaymentMethod | null;
  whatsappSentAt: string | null;
  itemsSummary: string;
}

/**
 * Las facturas del paciente en la pestaña Contable: emitir una nueva y, por
 * cada una, descargar el PDF, mandarlo por WhatsApp o por correo, y anular
 * (sólo un administrador; una factura no se borra, se anula y el número
 * queda).
 */
export function InvoicesCard({
  invoices,
  canWrite,
  canVoid,
  dialog,
}: {
  invoices: InvoiceListItem[];
  canWrite: boolean;
  canVoid: boolean;
  dialog: Omit<InvoiceDialogProps, 'open' | 'onOpenChange' | 'trigger' | 'preselect'>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [sendingFor, setSendingFor] = React.useState<{ id: string; phone: string } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const uninvoiced = dialog.candidates.filter((c: InvoiceCandidateView) => !c.invoice);

  function send(id: string, phone: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await sendInvoiceWhatsappAction(id, phone);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSendingFor(null);
      setNotice('Factura enviada por WhatsApp.');
      router.refresh();
    });
  }

  function voidOne(inv: InvoiceListItem) {
    const reason = window.prompt(
      `¿Anular la factura ${inv.number}? Indica el motivo (queda registrado):`,
    );
    if (reason === null) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await voidInvoiceAction(inv.id, reason);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNotice(`Factura ${inv.number} anulada.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-(--color-border-subtle) p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">Facturas</h2>
          <p className="mt-0.5 text-[13px] text-zinc-600">
            {uninvoiced.length > 0
              ? `${uninvoiced.length} ${uninvoiced.length === 1 ? 'sesión atendida sin facturar' : 'sesiones atendidas sin facturar'}`
              : 'Todas las sesiones atendidas están facturadas'}
          </p>
        </div>
        {canWrite && (
          <InvoiceDialog
            {...dialog}
            trigger={
              <Button className="h-11 w-full md:w-auto">
                <FileText className="h-4 w-4" /> Nueva factura
              </Button>
            }
          />
        )}
      </div>

      {notice && (
        <p className="flex items-start gap-2 rounded-[14px] bg-emerald-50 p-3 text-[13px] text-emerald-800">
          <Check className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {invoices.length > 0 && (
        <ul className="flex flex-col gap-2">
          {invoices.map((inv) => {
            const voided = inv.status === 'VOID';
            const isSending = sendingFor?.id === inv.id;
            const mailto = buildInvoiceMailto({
              to: inv.billToEmail,
              clinicName: dialog.clinicName,
              number: inv.number,
              tutorName: inv.billToName,
              patientName: dialog.patientName,
              totalCents: inv.totalCents,
            });
            return (
              <li
                key={inv.id}
                className={cn(
                  'rounded-2xl border p-3.5',
                  voided
                    ? 'border-(--color-border) bg-zinc-50 opacity-75'
                    : 'border-(--color-border)',
                )}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="min-w-[200px] flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-zinc-900">
                      <span className={cn(voided && 'line-through')}>Factura {inv.number}</span>
                      {voided ? (
                        <Badge tone="danger">Anulada</Badge>
                      ) : inv.whatsappSentAt ? (
                        <Badge tone="success">Enviada por WhatsApp</Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[12px] text-zinc-600">
                      {inv.issuedOnLabel} · {inv.billToName}
                      {inv.paymentMethod
                        ? ` · ${INVOICE_PAYMENT_METHOD_LABELS[inv.paymentMethod]}`
                        : ''}{' '}
                      · {inv.itemsSummary}
                    </p>
                  </div>
                  <span className="text-[15px] font-bold tabular-nums text-zinc-900">
                    {formatCents(inv.totalCents)}
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Button asChild size="sm" variant="soft">
                    <a href={`/api/facturas/${inv.id}/pdf?download=1`}>
                      <Download className="h-3.5 w-3.5" /> Descargar
                    </a>
                  </Button>
                  {!voided && canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        setSendingFor(
                          isSending
                            ? null
                            : { id: inv.id, phone: inv.billToPhone ?? dialog.defaults.phone ?? '' },
                        )
                      }
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </Button>
                  )}
                  {!voided && (
                    <Button asChild size="sm" variant="ghost">
                      <a href={mailto}>
                        <Mail className="h-3.5 w-3.5" /> Correo
                      </a>
                    </Button>
                  )}
                  {!voided && canVoid && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      disabled={pending}
                      onClick={() => voidOne(inv)}
                    >
                      <Ban className="h-3.5 w-3.5" /> Anular
                    </Button>
                  )}
                </div>
                {isSending && sendingFor && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-[14px] bg-brand-50 p-3">
                    <Input
                      value={sendingFor.phone}
                      onChange={(e) => setSendingFor({ id: inv.id, phone: e.target.value })}
                      placeholder="Ej.: +34 600 111 222"
                      aria-label="WhatsApp del tutor"
                      className="h-10 max-w-[220px]"
                    />
                    <Button
                      size="sm"
                      disabled={pending || !sendingFor.phone.trim()}
                      onClick={() => send(inv.id, sendingFor.phone)}
                    >
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MessageCircle className="h-4 w-4" />
                      )}{' '}
                      Enviar el PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSendingFor(null)}
                      disabled={pending}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
