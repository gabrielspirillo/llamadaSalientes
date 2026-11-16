'use client';

import {
  deleteEntryAction,
  markEntryPaidAction,
  replicateRecurringAction,
} from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/input';
import { RECEIPT_ACCEPT } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  DOCUMENT_KIND_GROUP_LABELS,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_RECURRENCE_LABELS,
  type FinanceBasis,
  type FinancePaymentMethod,
  type LedgerLine,
  documentKindGroup,
  formatCents,
  formatDateKey,
  monthLabel,
  plural,
} from '@/lib/finance/model';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Hourglass,
  Loader2,
  Lock,
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
  type EntryCounterpartyOption,
  EntryDialog,
  type EntryProfessionalOption,
} from './entry-dialog';
import { uploadEntryFile } from './upload';

/**
 * El libro: cada línea con su fecha, concepto, categoría, importe y estado.
 * Las del libro propio se editan, se marcan pagadas, reciben comprobantes y
 * (el administrador) se borran. Las que vienen de las citas se leen aquí con
 * un candado y se tocan desde la ficha del paciente, que es su dueña.
 */
export function LedgerTable({
  lines,
  categories,
  professionals,
  counterparties,
  todayKey,
  basis,
  canWrite,
  canManage,
  monthKey,
  recurring,
}: {
  lines: LedgerLine[];
  categories: EntryCategoryOption[];
  professionals: EntryProfessionalOption[];
  counterparties: EntryCounterpartyOption[];
  todayKey: string;
  basis: FinanceBasis;
  canWrite: boolean;
  canManage: boolean;
  /** Mes al que "traer los recurrentes": el de hoy. */
  monthKey: string;
  /** Cuántos recurrentes tocan este mes y aún no están. */
  recurring: { candidates: number; alreadyCopied: number };
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
  const [deleting, setDeleting] = React.useState<LedgerLine | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  // Una fila se abre al tocarla: así la lista es compacta y las acciones no
  // ocupan una línea en cada movimiento.
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [visibleGroups, setVisibleGroups] = React.useState(14);
  const groups = React.useMemo(() => groupByDay(lines, basis), [lines, basis]);

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
            ? `Los recurrentes de ${monthLabel(monthKey)} ya estaban cargados.`
            : `${plural(r.data.created, 'gasto traído', 'gastos traídos')} a ${monthLabel(monthKey)} como ${r.data.created === 1 ? 'pendiente' : 'pendientes'}.`,
        );
      }
      return r;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canWrite && recurring.candidates > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-brand-100 bg-brand-50/60 px-3.5 py-3">
          <Repeat className="h-4 w-4 shrink-0 text-brand-700" />
          <p className="min-w-[200px] flex-1 text-[13px] text-zinc-800">
            <strong>
              {plural(recurring.candidates, 'gasto recurrente', 'gastos recurrentes')}
            </strong>{' '}
            tocan en {monthLabel(monthKey)} y aún no están. Se copian como pendientes (alquiler,
            cuota, seguro…) para que sólo tengas que marcarlos pagados.
          </p>
          <Button size="sm" onClick={replicate} disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Repeat className="h-4 w-4" />
            )}
            Traer {recurring.candidates === 1 ? 'el gasto' : `los ${recurring.candidates} gastos`}
          </Button>
        </div>
      )}
      {canWrite && recurring.candidates === 0 && recurring.alreadyCopied > 0 && (
        <p className="text-[12px] text-zinc-600">
          Los {plural(recurring.alreadyCopied, 'gasto recurrente', 'gastos recurrentes')} de{' '}
          {monthLabel(monthKey)} ya están cargados.
        </p>
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
        <div className="overflow-hidden rounded-[18px] border border-(--color-border) bg-white">
          {groups.slice(0, visibleGroups).map((g, gi) => (
            <section
              key={g.date}
              className={cn(gi > 0 && 'border-t border-(--color-border-subtle)')}
            >
              <header className="flex items-center justify-between gap-3 bg-zinc-50/80 px-4 py-2 text-[12px]">
                <span className="font-semibold capitalize text-zinc-700">
                  {dayLabel(g.date, todayKey)}
                </span>
                <span className="flex gap-3 tabular-nums">
                  {g.income > 0 && (
                    <span className="text-emerald-700">+{formatCents(g.income)}</span>
                  )}
                  {g.expense > 0 && (
                    <span className="text-amber-800">−{formatCents(g.expense)}</span>
                  )}
                </span>
              </header>
              <ul className="divide-y divide-(--color-border-subtle)">
                {g.lines.map((line) => {
                  const isEntry = line.source === 'entry';
                  const isIncome = line.kind === 'INCOME';
                  const paid = line.status === 'PAID';
                  const unbilled = line.source === 'appointment';
                  const isOpen = expanded === line.key;
                  const isPaying = paying?.key === line.key;
                  const fileHref = (id: string) =>
                    isEntry ? `/api/finanzas/files/${id}` : `/api/agenda/charges/files/${id}`;
                  const primary = isEntry ? line.concept : (line.patientName ?? line.concept);
                  const meta = (
                    isEntry
                      ? [
                          line.categoryName &&
                            `${line.categoryName}${line.isFixed ? ' · fijo' : ''}`,
                          line.counterparty,
                          line.paymentMethod && FINANCE_PAYMENT_METHOD_LABELS[line.paymentMethod],
                          line.recurrence &&
                            FINANCE_RECURRENCE_LABELS[line.recurrence].toLowerCase(),
                        ]
                      : [
                          line.treatmentName ?? line.concept,
                          line.professionalName,
                          line.paymentMethod && FINANCE_PAYMENT_METHOD_LABELS[line.paymentMethod],
                        ]
                  )
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <li key={line.key} className={cn(unbilled && 'bg-amber-50/40')}>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : line.key)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50/80"
                      >
                        <span
                          className={cn(
                            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                            unbilled
                              ? 'bg-amber-100 text-amber-700'
                              : isIncome
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700',
                          )}
                        >
                          {unbilled ? (
                            <Hourglass className="h-4 w-4" />
                          ) : isIncome ? (
                            <ArrowDownLeft className="h-4 w-4" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[14px] font-semibold text-zinc-900">
                            <span className="min-w-0 truncate">{primary}</span>
                            {!isEntry && (
                              <Lock
                                className="h-3 w-3 shrink-0 text-zinc-400"
                                aria-label="Cobro de cita: se edita desde la ficha del paciente"
                              />
                            )}
                            {line.files.length > 0 && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-zinc-500">
                                <Paperclip className="h-3 w-3" />
                                {line.files.length}
                              </span>
                            )}
                          </span>
                          {meta && (
                            <span className="block truncate text-[12px] text-zinc-500">{meta}</span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span
                            className={cn(
                              'block text-[14.5px] font-bold tabular-nums',
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
                          <span
                            className={cn(
                              'mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium',
                              paid
                                ? 'text-emerald-700'
                                : unbilled
                                  ? 'text-amber-700'
                                  : 'text-zinc-500',
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                paid ? 'bg-emerald-500' : unbilled ? 'bg-amber-500' : 'bg-zinc-300',
                              )}
                            />
                            {paid
                              ? isIncome
                                ? 'Cobrado'
                                : 'Pagado'
                              : unbilled
                                ? 'Sin cobro'
                                : 'Pendiente'}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-300',
                            isOpen && 'rotate-180',
                          )}
                        />
                      </button>

                      {isOpen && (
                        <div className="animate-fade-in space-y-2.5 px-4 pb-3.5 pl-16">
                          {line.files.length > 0 && (
                            <ul className="flex flex-wrap gap-1.5">
                              {line.files.map((f) => (
                                <li key={f.id}>
                                  <a
                                    href={fileHref(f.id)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] bg-zinc-100 px-2.5 py-1 text-[12px] text-zinc-800 hover:bg-zinc-200"
                                  >
                                    <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                                    <span className="max-w-[180px] truncate">{f.name}</span>
                                    <span className="text-zinc-600">
                                      · {DOCUMENT_KIND_GROUP_LABELS[documentKindGroup(f.kind)]}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}
                          {line.notes && (
                            <p className="text-[12.5px] text-zinc-600">{line.notes}</p>
                          )}
                          <p className="text-[12px] text-zinc-500">
                            Fecha {formatDateKey(line.occurredOn)}
                            {line.paidOn
                              ? ` · ${isIncome ? 'cobrado' : 'pagado'} el ${formatDateKey(line.paidOn)}`
                              : ''}
                          </p>

                          {isPaying && (
                            <div className="flex flex-wrap items-end gap-2 rounded-[14px] bg-brand-50 p-3">
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

                          <div className="flex flex-wrap gap-1.5">
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
                                    onClick={() => setDeleting(line)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" /> Borrar
                                  </Button>
                                )}
                              </>
                            )}
                            {line.patientKey && (
                              <Button asChild size="sm" variant={paid ? 'ghost' : 'soft'}>
                                <Link
                                  href={`/dashboard/agenda/pacientes/${encodeURIComponent(line.patientKey)}?tab=contable`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  {paid ? 'Abrir ficha del paciente' : 'Cobrar desde la ficha'}
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {groups.length > visibleGroups && (
            <div className="border-t border-(--color-border-subtle) p-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => setVisibleGroups((v) => v + 14)}>
                Ver {plural(groups.length - visibleGroups, 'día más', 'días más')}
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={deleting ? `¿Borrar «${deleting.concept}»?` : 'Borrar movimiento'}
        description="Desaparece de las cuentas y del resumen. No se puede deshacer."
        details={
          deleting && deleting.files.length > 0
            ? [`Se borran también sus ${deleting.files.length} comprobante(s).`]
            : undefined
        }
        confirmLabel="Borrar movimiento"
        onConfirm={() => {
          if (deleting) run(() => deleteEntryAction(deleting.sourceId), 'Movimiento borrado.');
          return null;
        }}
      />

      {editing && (
        <EntryDialog
          mode="edit"
          entry={editing}
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
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

interface DayGroup {
  date: string;
  lines: LedgerLine[];
  income: number;
  expense: number;
}

/** Las líneas ya vienen ordenadas: se agrupan por el día que cuenta en la base elegida. */
function groupByDay(lines: LedgerLine[], basis: FinanceBasis): DayGroup[] {
  const out: DayGroup[] = [];
  for (const line of lines) {
    const date =
      basis === 'cash' && line.status === 'PAID' && line.paidOn ? line.paidOn : line.occurredOn;
    let g = out[out.length - 1];
    if (!g || g.date !== date) {
      g = { date, lines: [], income: 0, expense: 0 };
      out.push(g);
    }
    g.lines.push(line);
    if (line.amountCents !== null && line.status === 'PAID') {
      if (line.kind === 'INCOME') g.income += line.amountCents;
      else g.expense += line.amountCents;
    }
  }
  return out;
}

function dayLabel(date: string, todayKey: string): string {
  if (date === todayKey) return 'Hoy';
  const d = new Date(`${date}T12:00:00Z`);
  const t = new Date(`${todayKey}T12:00:00Z`);
  if (Math.round((t.getTime() - d.getTime()) / 86_400_000) === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: d.getUTCFullYear() === t.getUTCFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}
