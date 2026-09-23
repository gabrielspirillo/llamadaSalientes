'use client';

import { registerPaymentAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import {
  CHARGE_FILE_KIND_LABELS,
  CHARGE_STATUS_LABELS,
  type ChargeFileKind,
  type ChargeStatus,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  RECEIPT_ACCEPT,
  centsToInput,
  formatCents,
  parseAmountToCents,
  summarizeBilling,
} from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  AlertTriangle,
  Check,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Receipt,
  Upload,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** Una línea de la pestaña, ya formateada por el servidor con la zona de la clínica. */
export interface BillingLineView {
  key: string;
  chargeId: string | null;
  appointmentId: string | null;
  /** "mar, 22 sept 2026 · 17:30" */
  when: string;
  /** "Fisioterapia respiratoria · Dra. Ruiz" */
  concept: string;
  amountCents: number | null;
  status: ChargeStatus;
  paymentMethod: PaymentMethod | null;
  /** "14 mar 2026" */
  paidOnLabel: string | null;
  files: { id: string; name: string; kind: ChargeFileKind }[];
}

interface PayForm {
  lineKey: string;
  amount: string;
  paidOn: string;
  method: PaymentMethod;
  file: File | null;
}

/**
 * Pestaña Contable: lo facturado, cobrado y pendiente arriba; por cada cita su
 * pago y sus comprobantes; y el formulario de "registrar pago" en línea, que
 * se abre sobre la primera cita pendiente o sobre la que se elija.
 *
 * El pago va por Server Action y el comprobante, si lo hay, por el endpoint de
 * subida después: un archivo no cabe en una acción. Si el pago entra y el
 * archivo no, se dice tal cual: el pago no se pierde.
 */
export function BillingPanel({
  lines,
  todayKey,
  canWrite,
}: {
  lines: BillingLineView[];
  /** 'YYYY-MM-DD' de hoy en la zona de la clínica: la fecha de pago por defecto. */
  todayKey: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<PayForm | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const totals = React.useMemo(
    () =>
      summarizeBilling(
        lines.map((l) => ({
          key: l.key,
          chargeId: l.chargeId,
          appointmentId: l.appointmentId,
          at: new Date(0),
          concept: l.concept,
          amountCents: l.amountCents,
          status: l.status,
          paymentMethod: l.paymentMethod,
          paidOn: null,
          files: l.files,
        })),
      ),
    [lines],
  );

  function openPay(line: BillingLineView) {
    setError(null);
    setNotice(null);
    setForm({
      lineKey: line.key,
      amount: centsToInput(line.amountCents),
      paidOn: todayKey,
      method: line.paymentMethod ?? 'CARD',
      file: null,
    });
  }

  function openFirstDue() {
    const target = lines.find((l) => l.status === 'PENDING') ?? lines[0];
    if (target) openPay(target);
  }

  async function upload(line: Pick<BillingLineView, 'chargeId' | 'appointmentId'>, file: File) {
    const body = new FormData();
    if (line.chargeId) body.set('chargeId', line.chargeId);
    else if (line.appointmentId) body.set('appointmentId', line.appointmentId);
    body.set('file', file);
    const res = await fetch('/api/agenda/charges/files', { method: 'POST', body });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? 'No se pudo subir el comprobante.');
    }
  }

  function savePay() {
    if (!form) return;
    const line = lines.find((l) => l.key === form.lineKey);
    if (!line) return;
    if (parseAmountToCents(form.amount) === null) {
      setError('Escribe el importe, por ejemplo 45 o 45,50.');
      return;
    }
    setError(null);
    setNotice(null);
    const file = form.file;
    startTransition(async () => {
      const result = await registerPaymentAction({
        appointmentId: line.appointmentId,
        chargeId: line.chargeId,
        amount: form.amount,
        paidOn: form.paidOn,
        paymentMethod: form.method,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (file) {
        try {
          await upload({ chargeId: result.data.chargeId, appointmentId: null }, file);
          setNotice({ tone: 'ok', text: 'Pago registrado y comprobante guardado.' });
        } catch (err) {
          setNotice({
            tone: 'warn',
            text: `El pago quedó registrado, pero el comprobante no se subió: ${(err as Error).message} Vuelve a adjuntarlo desde la cita.`,
          });
        }
      } else {
        setNotice({ tone: 'ok', text: 'Pago registrado.' });
      }
      setForm(null);
      router.refresh();
    });
  }

  function attach(line: BillingLineView, file: File) {
    setError(null);
    setNotice(null);
    setUploading(line.key);
    upload(line, file)
      .then(() => {
        setNotice({ tone: 'ok', text: 'Comprobante guardado.' });
        router.refresh();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setUploading(null));
  }

  const formLine = form ? lines.find((l) => l.key === form.lineKey) : null;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">Contable</h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            Pagos, facturas y comprobantes de cada cita
          </p>
        </div>
        {canWrite && (
          <Button
            onClick={openFirstDue}
            disabled={lines.length === 0 || pending}
            className="h-11 w-full md:w-auto"
          >
            <Plus className="h-4 w-4" /> Registrar pago
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[--color-border-subtle] bg-[--color-border-subtle]">
        <Total label="Facturado" value={formatCents(totals.billedCents)} />
        <Total label="Cobrado" value={formatCents(totals.paidCents)} tone="paid" />
        <Total
          label="Pendiente"
          value={formatCents(totals.dueCents)}
          tone={totals.dueCents > 0 ? 'due' : 'default'}
        />
      </dl>

      {notice && (
        <p
          className={cn(
            'flex items-start gap-2 rounded-[14px] p-3 text-[13px]',
            notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
          )}
        >
          {notice.tone === 'ok' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {notice.text}
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

      {form && formLine && (
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-brand-100 bg-brand-50 p-4">
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-zinc-900">Registrar pago</p>
              <p className="mt-0.5 text-[13px] text-brand-800">
                {formLine.when} · {formLine.concept}
              </p>
            </div>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => setForm(null)}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-600 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-zinc-700">Importe (€)</span>
              <input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="45,00"
                className="h-11 rounded-[14px] border border-[--color-border] bg-white px-3.5 text-[16px] text-zinc-900 outline-none focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/12"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-zinc-700">Fecha de pago</span>
              <input
                type="date"
                value={form.paidOn}
                onChange={(e) => setForm({ ...form, paidOn: e.target.value })}
                className="h-11 rounded-[14px] border border-[--color-border] bg-white px-3.5 text-[16px] text-zinc-900 outline-none focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/12"
              />
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-zinc-700">Método</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {PAYMENT_METHODS.map((m) => {
                const active = form.method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setForm({ ...form, method: m })}
                    className={cn(
                      'min-h-11 whitespace-nowrap rounded-xl px-2.5 text-[14px] font-semibold ring-1 transition-colors',
                      active
                        ? 'bg-brand-600 text-white ring-brand-600'
                        : 'bg-white text-zinc-700 ring-[--color-border] hover:bg-brand-100/60',
                    )}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-brand-200 bg-white px-3.5 py-2.5">
            <input
              type="file"
              accept={RECEIPT_ACCEPT}
              className="hidden"
              onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })}
            />
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Upload className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-semibold text-zinc-800">
                {form.file?.name ?? 'Adjuntar comprobante'}
              </span>
              <span className="text-[12px] text-zinc-500">
                Factura, ticket del TPV o justificante · PDF o foto
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setForm(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={savePay} disabled={pending}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Guardar pago
            </Button>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title="Nada que cobrar todavía"
          description="Cuando el paciente tenga citas, aquí se registra el pago de cada una y se guardan sus comprobantes."
        />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lines.map((line) => {
            const paid = line.status === 'PAID';
            return (
              <li
                key={line.key}
                className="flex flex-col gap-2.5 rounded-2xl border border-[--color-border] p-3.5"
              >
                <div className="flex flex-wrap items-start gap-2 md:gap-3">
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[14px] font-semibold text-zinc-800">{line.when}</p>
                    <p className="mt-0.5 text-[12px] text-zinc-500">{line.concept}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[15px] font-bold',
                        line.amountCents === null ? 'text-zinc-400' : 'text-zinc-900',
                      )}
                    >
                      {line.amountCents === null ? 'Sin importe' : formatCents(line.amountCents)}
                    </span>
                    <Badge tone={paid ? 'success' : 'warn'}>
                      {CHARGE_STATUS_LABELS[line.status]}
                    </Badge>
                  </div>
                </div>
                {paid && (
                  <p className="text-[13px] text-zinc-600">
                    Pagado
                    {line.paymentMethod
                      ? ` con ${PAYMENT_METHOD_LABELS[line.paymentMethod].toLowerCase()}`
                      : ''}
                    {line.paidOnLabel ? ` · ${line.paidOnLabel}` : ''}
                  </p>
                )}
                {line.files.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {line.files.map((f) => (
                      <li key={f.id}>
                        <a
                          href={`/api/agenda/charges/files/${f.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] bg-zinc-100 px-2.5 py-1.5 text-[12px] text-zinc-800 hover:bg-zinc-200"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                          <span className="truncate">{f.name}</span>
                          <span className="text-zinc-500">· {CHARGE_FILE_KIND_LABELS[f.kind]}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    {!paid && (
                      <Button size="sm" onClick={() => openPay(line)} disabled={pending}>
                        Registrar pago
                      </Button>
                    )}
                    <label
                      className={cn(
                        'inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-[--color-border] bg-white px-3.5 text-[13px] font-semibold text-zinc-800 hover:border-brand-200 hover:text-brand-700',
                        uploading === line.key && 'pointer-events-none opacity-60',
                      )}
                    >
                      <input
                        type="file"
                        accept={RECEIPT_ACCEPT}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) attach(line, f);
                          e.target.value = '';
                        }}
                      />
                      {uploading === line.key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5" />
                      )}
                      Adjuntar comprobante
                    </label>
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

function Total({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'paid' | 'due';
}) {
  return (
    <div className="flex flex-col gap-[3px] bg-[#fbfcfc] px-3.5 py-3">
      <dt className="text-[12px] text-zinc-500">{label}</dt>
      <dd
        className={cn(
          'text-[15px] font-bold tabular-nums md:text-[18px]',
          tone === 'paid'
            ? 'text-emerald-600'
            : tone === 'due'
              ? 'text-amber-700'
              : 'text-zinc-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
