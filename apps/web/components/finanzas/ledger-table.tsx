'use client';

import {
  deleteEntryAction,
  markEntryPaidAction,
  replicateRecurringAction,
} from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { CHARGE_FILE_KIND_LABELS, RECEIPT_ACCEPT } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinanceBasis,
  type FinancePaymentMethod,
  type LedgerLine,
  formatCents,
  formatDateKey,
  monthLabel,
} from '@/lib/finance/model';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Paperclip,
  Pencil,
  Receipt,
  Repeat,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  type EntryCategoryOption,
  EntryDialog,
  type EntryProfessionalOption,
} from './entry-dialog';
import { uploadEntryFile } from './upload';

/**
 * El libro: cada línea con su fecha, concepto, categoría, importe y estado.
 * Las del libro propio se editan, se marcan pagadas, reciben comprobantes y
 * (el administrador) se borran. Las que vienen de las citas se leen aquí y se
 * tocan desde la ficha del paciente, que es su dueña.
 */
export function LedgerTable({
  lines,
  categories,
  professionals,
  todayKey,
  basis,
  canWrite,
  canManage,
  monthKey,
}: {
  lines: LedgerLine[];
  categories: EntryCategoryOption[];
  professionals: EntryProfessionalOption[];
  todayKey: string;
  basis: FinanceBasis;
  canWrite: boolean;
  canManage: boolean;
  /** Mes al que "traer los recurrentes": el de hoy. */
  monthKey: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState<LedgerLine | null>(null);
  const [paying, setPaying] = React.useState<{
    key: string;
    paidOn: string;
    method: FinancePaymentMethod | '';
  } | null>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? 'No se pudo completar.');
        return;
      }
      if (okText) setNotice(okText);
      router.refresh();
    });
  }

  function attach(line: LedgerLine, file: File) {
    setError(null);
    setNotice(null);
    setUploading(line.key);
    uploadEntryFile(line.sourceId, file)
      .then(() => {
        setNotice('Comprobante guardado.');
        router.refresh();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setUploading(null));
  }

  function replicate() {
    run(async () => {
      const r = await replicateRecurringAction(monthKey);
      if (r.ok) {
        setNotice(
          r.data.created === 0
            ? r.data.skipped > 0
              ? `Los recurrentes de ${monthLabel(monthKey)} ya estaban.`
              : 'No hay gastos marcados como recurrentes el mes pasado.'
            : `${r.data.created} gasto${r.data.created === 1 ? '' : 's'} traído${r.data.created === 1 ? '' : 's'} a ${monthLabel(monthKey)} como pendiente${r.data.created === 1 ? '' : 's'}.`,
        );
      }
      return r;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={replicate} disabled={pending}>
            <Repeat className="h-4 w-4" /> Traer gastos recurrentes de {monthLabel(monthKey)}
          </Button>
        </div>
      )}

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

      {lines.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-5 w-5" />}
          title="Sin movimientos en este período"
          description="Registra un gasto o un ingreso con «Nuevo movimiento», o cambia el período y los filtros."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line) => {
            const isEntry = line.source === 'entry';
            const isIncome = line.kind === 'INCOME';
            const paid = line.status === 'PAID';
            const date = basis === 'cash' && paid && line.paidOn ? line.paidOn : line.occurredOn;
            const fileHref = (id: string) =>
              isEntry ? `/api/finanzas/files/${id}` : `/api/agenda/charges/files/${id}`;
            const isPaying = paying?.key === line.key;
            return (
              <li
                key={line.key}
                className={cn(
                  'rounded-2xl border bg-white p-3.5 transition-colors',
                  line.source === 'appointment'
                    ? 'border-amber-200 bg-amber-50/40'
                    : 'border-(--color-border)',
                )}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                  <div className="w-[88px] shrink-0">
                    <p className="text-[13px] font-semibold text-zinc-800">
                      {formatDateKey(date, { year: false })}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {basis === 'cash' && paid ? 'pagado' : 'fecha'}
                      {line.paidOn && line.paidOn !== line.occurredOn && basis !== 'cash'
                        ? ` · pag. ${formatDateKey(line.paidOn, { year: false })}`
                        : ''}
                    </p>
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <p className="text-[14px] font-semibold text-zinc-900">{line.concept}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-zinc-500">
                      {line.categoryName && (
                        <span>
                          {line.categoryName}
                          {line.isFixed ? ' · fijo' : ''}
                        </span>
                      )}
                      {line.patientName && <span>{line.patientName}</span>}
                      {line.counterparty && <span>{line.counterparty}</span>}
                      {line.professionalName && <span>{line.professionalName}</span>}
                      {line.paymentMethod && (
                        <span>{FINANCE_PAYMENT_METHOD_LABELS[line.paymentMethod]}</span>
                      )}
                      {line.isRecurring && (
                        <span className="inline-flex items-center gap-0.5">
                          <Repeat className="h-3 w-3" /> mensual
                        </span>
                      )}
                    </p>
                    {line.files.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {line.files.map((f) => (
                          <li key={f.id}>
                            <a
                              href={fileHref(f.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] bg-zinc-100 px-2.5 py-1 text-[12px] text-zinc-800 hover:bg-zinc-200"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                              <span className="max-w-[160px] truncate">{f.name}</span>
                              <span className="text-zinc-500">
                                · {CHARGE_FILE_KIND_LABELS[f.kind]}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[15px] font-bold tabular-nums',
                        line.amountCents === null
                          ? 'text-zinc-500'
                          : isIncome
                            ? 'text-emerald-700'
                            : 'text-zinc-900',
                      )}
                    >
                      {line.amountCents === null
                        ? 'Sin importe'
                        : `${isIncome ? '+' : '−'}${formatCents(line.amountCents)}`}
                    </span>
                    <Badge
                      tone={paid ? 'success' : line.source === 'appointment' ? 'warn' : 'neutral'}
                    >
                      {paid
                        ? isIncome
                          ? 'Cobrado'
                          : 'Pagado'
                        : line.source === 'appointment'
                          ? 'Sin cobro'
                          : 'Pendiente'}
                    </Badge>
                  </div>
                </div>

                {isPaying && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[14px] bg-brand-50 p-3">
                    <label
                      htmlFor={`pay-date-${line.key}`}
                      className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-700"
                    >
                      {isIncome ? 'Fecha de cobro' : 'Fecha de pago'}
                      <Input
                        id={`pay-date-${line.key}`}
                        type="date"
                        value={paying.paidOn}
                        onChange={(e) => setPaying({ ...paying, paidOn: e.target.value })}
                        className="h-10 w-[160px]"
                      />
                    </label>
                    <label
                      htmlFor={`pay-method-${line.key}`}
                      className="flex flex-col gap-1 text-[12px] font-semibold text-zinc-700"
                    >
                      Método
                      <Select
                        id={`pay-method-${line.key}`}
                        value={paying.method}
                        onChange={(e) =>
                          setPaying({
                            ...paying,
                            method: e.target.value as FinancePaymentMethod | '',
                          })
                        }
                        className="h-10 w-[170px]"
                      >
                        <option value="">Sin especificar</option>
                        {FINANCE_PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {FINANCE_PAYMENT_METHOD_LABELS[m]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const input = {
                          paidOn: paying.paidOn,
                          paymentMethod: paying.method || null,
                        };
                        setPaying(null);
                        run(
                          () => markEntryPaidAction(line.sourceId, input),
                          isIncome ? 'Cobro registrado.' : 'Pago registrado.',
                        );
                      }}
                    >
                      {pending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                      Confirmar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPaying(null)}
                      disabled={pending}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}

                {(canWrite || line.patientKey) && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {isEntry && canWrite && (
                      <>
                        {!paid && (
                          <Button
                            size="sm"
                            variant="soft"
                            disabled={pending}
                            onClick={() =>
                              setPaying({
                                key: line.key,
                                paidOn: todayKey,
                                method: line.paymentMethod ?? '',
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" />{' '}
                            {isIncome ? 'Marcar cobrado' : 'Marcar pagado'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setEditing(line)}
                        >
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                        <label
                          className={cn(
                            'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-zinc-700 hover:bg-zinc-100',
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
                          Adjuntar
                        </label>
                        {canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            disabled={pending}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `¿Borrar «${line.concept}»? Se borran también sus comprobantes.`,
                                )
                              )
                                return;
                              run(() => deleteEntryAction(line.sourceId), 'Movimiento borrado.');
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Borrar
                          </Button>
                        )}
                      </>
                    )}
                    {line.patientKey && (
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/dashboard/agenda/pacientes/${encodeURIComponent(line.patientKey)}?tab=contable`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {paid ? 'Ver en la ficha' : 'Cobrar desde la ficha'}
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EntryDialog
          mode="edit"
          entry={editing}
          categories={categories}
          professionals={professionals}
          todayKey={todayKey}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
