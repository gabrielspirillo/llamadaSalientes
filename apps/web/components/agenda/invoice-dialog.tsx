'use client';

import {
  issueInvoiceAction,
  sendInvoiceWhatsappAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { type PaymentMethod, centsToInput, parseAmountToCents } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_METHOD_LABELS,
  type InvoiceBillTo,
  buildInvoiceMailto,
  computeTotals,
  formatCents,
  groupSessionsIntoItems,
} from '@/lib/invoices/model';
import {
  AlertTriangle,
  Check,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** Una sesión facturable, tal como la prepara la ficha (servidor). */
export interface InvoiceCandidateView {
  appointmentId: string;
  /** "mar, 22 sept 2026 · 17:30" */
  when: string;
  /** Concepto propuesto: el de la clínica o el nombre del tratamiento. */
  concept: string;
  unitCents: number | null;
  chargeStatus: 'PAID' | 'PENDING';
  paymentMethod: PaymentMethod | null;
  /** Ya facturada: no se puede volver a elegir. */
  invoice: { id: string; number: string } | null;
}

export interface InvoiceDialogProps {
  patientKey: string;
  patientId: string | null;
  patientName: string;
  clinicName: string;
  /** Quien emite, para que se vea antes de emitir. */
  issuerName: string;
  vatRate: number;
  defaults: InvoiceBillTo;
  candidates: InvoiceCandidateView[];
  todayKey: string;
  /** Con qué se preselecciona al abrir. Sin lista: todas las sin facturar. */
  preselect?: string[] | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

interface LineState {
  key: string;
  concept: string;
  quantity: string;
  unit: string;
  appointmentIds: string[];
}

interface Issued {
  id: string;
  number: string;
  totalCents: number;
  warning: string | null;
}

let extraSeq = 0;

/**
 * Emitir una factura desde la ficha: a quién (el tutor, ya relleno), qué
 * sesiones (las atendidas sin facturar, ya marcadas) agrupadas en líneas,
 * cómo se pagó, y listo. Al emitir sale el número, el PDF para descargar y
 * los botones para mandarlo por WhatsApp o por correo.
 *
 * Todo lo que se puede rellenar solo, se rellena solo; todo se puede tocar.
 */
export function InvoiceDialog({
  patientKey,
  patientId,
  patientName,
  clinicName,
  issuerName,
  vatRate,
  defaults,
  candidates,
  todayKey,
  preselect = null,
  open: openProp,
  onOpenChange,
  trigger,
}: InvoiceDialogProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [pending, startTransition] = React.useTransition();

  const invoiceable = React.useMemo(() => candidates.filter((c) => !c.invoice), [candidates]);
  const initialSelection = React.useCallback(
    () =>
      new Set(
        preselect
          ? preselect.filter((id) => invoiceable.some((c) => c.appointmentId === id))
          : invoiceable.map((c) => c.appointmentId),
      ),
    [preselect, invoiceable],
  );

  const [billTo, setBillTo] = React.useState<InvoiceBillTo>(defaults);
  const [selected, setSelected] = React.useState<Set<string>>(initialSelection);
  const [sessionLines, setSessionLines] = React.useState<LineState[]>([]);
  const [extraLines, setExtraLines] = React.useState<LineState[]>([]);
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod | ''>('CASH');
  const [issuedOn, setIssuedOn] = React.useState(todayKey);
  const [notes, setNotes] = React.useState('');
  const [registerPayment, setRegisterPayment] = React.useState(true);
  const [rememberBillTo, setRememberBillTo] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<Issued | null>(null);
  const [waPhone, setWaPhone] = React.useState(defaults.phone ?? '');
  const [waState, setWaState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [waError, setWaError] = React.useState<string | null>(null);

  /** Las líneas de sesiones salen de la selección: mismas concepto y precio → una línea con cantidad. */
  const rebuildSessionLines = React.useCallback(
    (sel: Set<string>) => {
      const chosen = invoiceable.filter((c) => sel.has(c.appointmentId));
      setSessionLines(
        groupSessionsIntoItems(
          chosen.map((c) => ({
            appointmentId: c.appointmentId,
            concept: c.concept,
            unitCents: c.unitCents,
          })),
        ).map((it, i) => ({
          key: `s-${i}-${it.appointmentIds[0]}`,
          concept: it.concept,
          quantity: String(it.quantity),
          unit: it.unitCents > 0 ? centsToInput(it.unitCents) : '',
          appointmentIds: it.appointmentIds,
        })),
      );
      const paidOne = chosen.find((c) => c.chargeStatus === 'PAID' && c.paymentMethod);
      if (paidOne?.paymentMethod) setPaymentMethod(paidOne.paymentMethod);
      setRegisterPayment(chosen.some((c) => c.chargeStatus === 'PENDING'));
    },
    [invoiceable],
  );

  // Cada apertura parte de los datos de la ficha, no de lo que quedó de la anterior.
  React.useEffect(() => {
    if (!open) return;
    const sel = initialSelection();
    setBillTo(defaults);
    setSelected(sel);
    rebuildSessionLines(sel);
    setExtraLines([]);
    setIssuedOn(todayKey);
    setNotes('');
    setRememberBillTo(true);
    setError(null);
    setIssued(null);
    setWaPhone(defaults.phone ?? '');
    setWaState('idle');
    setWaError(null);
  }, [open, defaults, todayKey, initialSelection, rebuildSessionLines]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      rebuildSessionLines(next);
      return next;
    });
  }

  const allLines = [...sessionLines, ...extraLines];
  const parsedItems = allLines.map((l) => ({
    concept: l.concept,
    quantity: Number(l.quantity) || 0,
    unitCents: parseAmountToCents(l.unit) ?? 0,
    appointmentIds: l.appointmentIds,
  }));
  const totals = computeTotals(parsedItems, vatRate);
  const anyPendingSelected = invoiceable.some(
    (c) => selected.has(c.appointmentId) && c.chargeStatus === 'PENDING',
  );

  function updateLine(list: 'session' | 'extra', key: string, patch: Partial<LineState>) {
    const setter = list === 'session' ? setSessionLines : setExtraLines;
    setter((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function submit() {
    setError(null);
    if (!billTo.name.trim()) {
      setError('Falta el nombre de a quién se factura.');
      return;
    }
    if (allLines.length === 0) {
      setError('Elige al menos una sesión o añade una línea.');
      return;
    }
    for (const l of allLines) {
      if (!l.concept.trim()) {
        setError('Hay una línea sin concepto.');
        return;
      }
      if (!Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1) {
        setError(`La cantidad de «${l.concept}» no es válida.`);
        return;
      }
      if (parseAmountToCents(l.unit) === null) {
        setError(`Falta el precio de «${l.concept}».`);
        return;
      }
    }
    startTransition(async () => {
      const r = await issueInvoiceAction({
        patientKey,
        patientId,
        patientName,
        billTo,
        items: allLines.map((l) => ({
          concept: l.concept,
          quantity: Number(l.quantity),
          unit: l.unit,
          appointmentIds: l.appointmentIds,
        })),
        paymentMethod: paymentMethod || null,
        issuedOn,
        notes: notes || null,
        registerPayment: registerPayment && anyPendingSelected,
        rememberBillTo,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setIssued({
        id: r.data.id,
        number: r.data.number,
        totalCents: r.data.totalCents,
        warning: r.data.warning ?? null,
      });
      router.refresh();
    });
  }

  function sendWhatsapp() {
    if (!issued) return;
    setWaState('sending');
    setWaError(null);
    startTransition(async () => {
      const r = await sendInvoiceWhatsappAction(issued.id, waPhone);
      if (!r.ok) {
        setWaState('error');
        setWaError(r.error);
        return;
      }
      setWaState('sent');
      router.refresh();
    });
  }

  const mailto = issued
    ? buildInvoiceMailto({
        to: billTo.email,
        clinicName,
        number: issued.number,
        tutorName: billTo.name,
        patientName,
        totalCents: issued.totalCents,
      })
    : '#';

  const content = (
    <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden">
      <DialogHeader className="mb-3 shrink-0">
        <DialogTitle>{issued ? `Factura ${issued.number} emitida` : 'Nueva factura'}</DialogTitle>
        <DialogDescription>
          {issued
            ? 'Descárgala para mandarla por correo, o envíala por WhatsApp desde aquí.'
            : `Emite ${issuerName}. Se factura al tutor por las sesiones de ${patientName}.`}
        </DialogDescription>
      </DialogHeader>

      {issued ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex items-center gap-4 rounded-[18px] bg-emerald-50 p-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-700 ring-1 ring-emerald-200">
              <Receipt className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[16px] font-bold text-zinc-900">
                {issued.number} · {formatCents(issued.totalCents)}
              </p>
              <p className="text-[13px] text-zinc-700">
                A nombre de {billTo.name}. Queda en la pestaña Contable de la ficha.
              </p>
            </div>
          </div>
          {issued.warning && (
            <p className="flex items-start gap-2 rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {issued.warning}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Button asChild>
              <a href={`/api/facturas/${issued.id}/pdf?download=1`}>
                <Download className="h-4 w-4" /> Descargar PDF
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={mailto}>
                <Mail className="h-4 w-4" /> Enviar por correo
              </a>
            </Button>
          </div>
          <p className="-mt-1 text-[12px] text-zinc-600">
            El correo se abre ya escrito; adjunta el PDF descargado.
          </p>
          <div className="rounded-[18px] border border-(--color-border) p-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold text-zinc-900">
              <MessageCircle className="h-4 w-4 text-emerald-600" /> Enviar por WhatsApp
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-600">
              Sale por el número de la clínica con el PDF adjunto.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="Ej.: +34 600 111 222"
                aria-label="WhatsApp del tutor"
                className="h-10 max-w-[220px]"
                disabled={waState === 'sending' || waState === 'sent'}
              />
              <Button
                size="sm"
                onClick={sendWhatsapp}
                disabled={waState === 'sending' || waState === 'sent' || !waPhone.trim()}
              >
                {waState === 'sending' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : waState === 'sent' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                {waState === 'sent' ? 'Enviada' : 'Enviar'}
              </Button>
            </div>
            {waError && (
              <p role="alert" className="mt-2 flex items-start gap-2 text-[12px] text-rose-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {waError}
              </p>
            )}
          </div>
          <div className="flex justify-end border-t border-(--color-border-subtle) pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 pb-2">
            {/* A quién */}
            <section className="flex flex-col gap-3">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700">
                Facturar a · Tutor/a legal
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="inv-name">Nombre y apellidos</Label>
                  <Input
                    id="inv-name"
                    value={billTo.name}
                    onChange={(e) => setBillTo({ ...billTo, name: e.target.value })}
                    maxLength={160}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inv-nif">NIF / NIE</Label>
                  <Input
                    id="inv-nif"
                    value={billTo.taxId ?? ''}
                    onChange={(e) => setBillTo({ ...billTo, taxId: e.target.value || null })}
                    placeholder="Ej.: 70055622Z"
                    className="placeholder:text-zinc-400/80"
                    maxLength={24}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inv-address">
                    Dirección <span className="font-normal text-zinc-500">(opcional)</span>
                  </Label>
                  <Input
                    id="inv-address"
                    value={billTo.address ?? ''}
                    onChange={(e) => setBillTo({ ...billTo, address: e.target.value || null })}
                    maxLength={240}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inv-email">
                    Correo <span className="font-normal text-zinc-500">(opcional)</span>
                  </Label>
                  <Input
                    id="inv-email"
                    type="email"
                    value={billTo.email ?? ''}
                    onChange={(e) => setBillTo({ ...billTo, email: e.target.value || null })}
                    maxLength={160}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="inv-phone">
                    WhatsApp <span className="font-normal text-zinc-500">(opcional)</span>
                  </Label>
                  <Input
                    id="inv-phone"
                    value={billTo.phone ?? ''}
                    onChange={(e) => setBillTo({ ...billTo, phone: e.target.value || null })}
                    maxLength={40}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={rememberBillTo}
                  onChange={(e) => setRememberBillTo(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 accent-brand-600"
                />
                Recordar estos datos en la ficha para la próxima factura
              </label>
            </section>

            {/* Qué sesiones */}
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700">
                Sesiones
              </h3>
              {invoiceable.length === 0 ? (
                <p className="rounded-[14px] bg-zinc-50 p-3 text-[13px] text-zinc-600">
                  No hay sesiones atendidas sin facturar. Puedes añadir una línea a mano (un bono,
                  un producto).
                </p>
              ) : (
                <ul className="divide-y divide-(--color-border-subtle) rounded-2xl border border-(--color-border)">
                  {invoiceable.map((c) => {
                    const on = selected.has(c.appointmentId);
                    return (
                      <li key={c.appointmentId}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-[13px]',
                            on ? 'bg-brand-50/50' : 'hover:bg-zinc-50',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(c.appointmentId)}
                            className="h-4 w-4 rounded border-zinc-300 accent-brand-600"
                          />
                          <span className="w-[150px] shrink-0 font-semibold text-zinc-800">
                            {c.when}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-700">{c.concept}</span>
                          <span className="shrink-0 tabular-nums text-zinc-900">
                            {c.unitCents === null ? 'Sin precio' : formatCents(c.unitCents)}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              c.chargeStatus === 'PAID'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700',
                            )}
                          >
                            {c.chargeStatus === 'PAID' ? 'Cobrada' : 'Pendiente'}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {candidates.some((c) => c.invoice) && (
                <p className="text-[12px] text-zinc-600">
                  {candidates.filter((c) => c.invoice).length} sesión(es) ya facturadas no se
                  muestran.
                </p>
              )}
            </section>

            {/* Líneas */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.14em] text-brand-700">
                  Conceptos
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    extraSeq += 1;
                    setExtraLines((l) => [
                      ...l,
                      {
                        key: `x-${extraSeq}`,
                        concept: '',
                        quantity: '1',
                        unit: '',
                        appointmentIds: [],
                      },
                    ]);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Añadir línea
                </Button>
              </div>
              <div className="overflow-hidden rounded-2xl border border-(--color-border)">
                <div className="grid grid-cols-[1fr_64px_96px_96px_36px] gap-2 bg-[#eef6f1] px-3 py-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-brand-700">
                  <span>Concepto</span>
                  <span className="text-center">Cant.</span>
                  <span className="text-right">Precio</span>
                  <span className="text-right">Importe</span>
                  <span />
                </div>
                {allLines.length === 0 && (
                  <p className="px-3 py-4 text-center text-[13px] text-zinc-600">Sin líneas.</p>
                )}
                {allLines.map((l) => {
                  const isExtra = l.appointmentIds.length === 0;
                  const list = isExtra ? 'extra' : 'session';
                  const amount = (parseAmountToCents(l.unit) ?? 0) * (Number(l.quantity) || 0);
                  return (
                    <div
                      key={l.key}
                      className="grid grid-cols-[1fr_64px_96px_96px_36px] items-center gap-2 border-t border-(--color-border-subtle) px-3 py-2"
                    >
                      <Input
                        value={l.concept}
                        onChange={(e) => updateLine(list, l.key, { concept: e.target.value })}
                        className="h-9 text-[13px]"
                        placeholder="Concepto"
                        aria-label="Concepto"
                      />
                      <Input
                        value={l.quantity}
                        onChange={(e) => updateLine(list, l.key, { quantity: e.target.value })}
                        inputMode="numeric"
                        className="h-9 px-2 text-center text-[13px]"
                        aria-label="Cantidad"
                      />
                      <Input
                        value={l.unit}
                        onChange={(e) => updateLine(list, l.key, { unit: e.target.value })}
                        inputMode="decimal"
                        className="h-9 px-2 text-right text-[13px]"
                        placeholder="0,00"
                        aria-label="Precio"
                      />
                      <span className="text-right text-[13px] font-semibold tabular-nums text-zinc-900">
                        {formatCents(Math.round(amount))}
                      </span>
                      {isExtra ? (
                        <button
                          type="button"
                          aria-label="Quitar línea"
                          onClick={() =>
                            setExtraLines((lines) => lines.filter((x) => x.key !== l.key))
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-rose-50 hover:text-rose-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  );
                })}
                <div className="flex justify-end border-t border-(--color-border) bg-[#fafbfb] px-3 py-3">
                  <dl className="w-[260px] space-y-1 text-[13px] tabular-nums">
                    <div className="flex justify-between">
                      <dt className="text-zinc-600">Base imponible</dt>
                      <dd>{formatCents(totals.subtotalCents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-600">
                        {vatRate > 0 ? `IVA ${vatRate} %` : 'IVA 0 % (exento)'}
                      </dt>
                      <dd>{formatCents(totals.vatCents)}</dd>
                    </div>
                    <div className="flex justify-between border-t-2 border-brand-600 pt-1.5">
                      <dt className="font-bold text-brand-700">TOTAL</dt>
                      <dd className="text-[16px] font-bold">{formatCents(totals.totalCents)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </section>

            {/* Cómo y cuándo */}
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-date">Fecha de la factura</Label>
                <Input
                  id="inv-date"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-method">Forma de pago</Label>
                <Select
                  id="inv-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}
                >
                  <option value="">Sin especificar</option>
                  {INVOICE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {INVOICE_PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="inv-notes">
                  Observaciones <span className="font-normal text-zinc-500">(opcional)</span>
                </Label>
                <Textarea
                  id="inv-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[44px] py-2.5"
                  maxLength={500}
                />
              </div>
              {anyPendingSelected && (
                <label className="flex items-center gap-2 text-[13px] text-zinc-700 sm:col-span-3">
                  <input
                    type="checkbox"
                    checked={registerPayment}
                    onChange={(e) => setRegisterPayment(e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 accent-brand-600"
                  />
                  Registrar también el cobro de las sesiones pendientes con esta forma de pago y
                  esta fecha
                </label>
              )}
            </section>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}
          </div>

          <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-(--color-border-subtle) pt-4">
            <p className="text-[12px] text-zinc-600">
              El número se asigna al emitir y no se puede reutilizar.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || allLines.length === 0}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Emitir factura
              </Button>
            </div>
          </div>
        </>
      )}
    </DialogContent>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : openProp === undefined ? (
        <DialogTrigger asChild>
          <Button>
            <FileText className="h-4 w-4" /> Nueva factura
          </Button>
        </DialogTrigger>
      ) : null}
      {content}
    </Dialog>
  );
}
