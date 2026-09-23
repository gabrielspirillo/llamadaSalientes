'use client';

import {
  type EntryFormInput,
  createEntryAction,
  updateEntryAction,
} from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/input';
import { RECEIPT_ACCEPT, centsToInput, parseAmountToCents } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinanceKind,
  type FinancePaymentMethod,
  type FinanceStatus,
  type LedgerLine,
} from '@/lib/finance/model';
import { AlertTriangle, Check, FileText, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { uploadEntryFile } from './upload';

export interface EntryCategoryOption {
  id: string;
  kind: FinanceKind;
  name: string;
  isFixed: boolean;
}

export interface EntryProfessionalOption {
  id: string;
  fullName: string;
}

interface FormState {
  kind: FinanceKind;
  concept: string;
  categoryId: string;
  counterparty: string;
  amount: string;
  tax: string;
  occurredOn: string;
  status: FinanceStatus;
  paidOn: string;
  paymentMethod: FinancePaymentMethod | '';
  professionalId: string;
  isRecurring: boolean;
  notes: string;
}

function initialState(
  todayKey: string,
  defaultKind: FinanceKind,
  entry: LedgerLine | null | undefined,
): FormState {
  if (entry && entry.source === 'entry') {
    return {
      kind: entry.kind,
      concept: entry.concept,
      categoryId: entry.categoryId ?? '',
      counterparty: entry.counterparty ?? '',
      amount: centsToInput(entry.amountCents),
      tax: entry.taxCents > 0 ? centsToInput(entry.taxCents) : '',
      occurredOn: entry.occurredOn,
      status: entry.status,
      paidOn: entry.paidOn ?? entry.occurredOn,
      paymentMethod: entry.paymentMethod ?? '',
      professionalId: entry.professionalId ?? '',
      isRecurring: entry.isRecurring,
      notes: entry.notes ?? '',
    };
  }
  return {
    kind: defaultKind,
    concept: '',
    categoryId: '',
    counterparty: '',
    amount: '',
    tax: '',
    occurredOn: todayKey,
    status: 'PAID',
    paidOn: todayKey,
    paymentMethod: defaultKind === 'EXPENSE' ? 'DIRECT_DEBIT' : 'CARD',
    professionalId: '',
    isRecurring: false,
    notes: '',
  };
}

/**
 * Alta y edición de un movimiento del libro: gasto o ingreso, con su
 * categoría, importe, fechas de devengo y de pago, método, proveedor, y los
 * comprobantes. El movimiento va por Server Action y los archivos, después,
 * por el endpoint de subida: un archivo no cabe en una acción. Si el
 * movimiento entra y un archivo no, se dice tal cual: el movimiento no se
 * pierde.
 *
 * Controlado (`open`/`onOpenChange`) o con `trigger` propio.
 */
export function EntryDialog({
  mode,
  entry,
  categories,
  professionals,
  todayKey,
  defaultKind = 'EXPENSE',
  initialFile = null,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  mode: 'create' | 'edit';
  entry?: LedgerLine | null;
  categories: EntryCategoryOption[];
  professionals: EntryProfessionalOption[];
  todayKey: string;
  defaultKind?: FinanceKind;
  /** Un comprobante ya elegido (desde Documentos): se sube al guardar. */
  initialFile?: File | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState<FormState>(() =>
    initialState(todayKey, defaultKind, entry),
  );
  const [files, setFiles] = React.useState<File[]>(initialFile ? [initialFile] : []);
  const [error, setError] = React.useState<string | null>(null);

  // Cada apertura parte limpia (o de la fila a editar): el estado de la
  // anterior no puede colarse en la siguiente.
  React.useEffect(() => {
    if (!open) return;
    setForm(initialState(todayKey, defaultKind, entry));
    setFiles(initialFile ? [initialFile] : []);
    setError(null);
  }, [open, todayKey, defaultKind, entry, initialFile]);

  const categoryOptions = categories.filter((c) => c.kind === form.kind);
  const isExpense = form.kind === 'EXPENSE';

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function switchKind(kind: FinanceKind) {
    setForm((f) => ({
      ...f,
      kind,
      categoryId: '',
      paymentMethod: kind === 'EXPENSE' ? 'DIRECT_DEBIT' : 'CARD',
    }));
  }

  function submit() {
    if (!form.concept.trim()) {
      setError('Escribe el concepto.');
      return;
    }
    if (parseAmountToCents(form.amount) === null) {
      setError('Escribe el importe, por ejemplo 45 o 45,50.');
      return;
    }
    setError(null);
    const input: EntryFormInput = {
      kind: form.kind,
      concept: form.concept,
      categoryId: form.categoryId || null,
      counterparty: form.counterparty || null,
      amount: form.amount,
      tax: form.tax || null,
      occurredOn: form.occurredOn,
      status: form.status,
      paidOn: form.status === 'PAID' ? form.paidOn || null : null,
      paymentMethod: form.status === 'PAID' && form.paymentMethod ? form.paymentMethod : null,
      professionalId: form.professionalId || null,
      isRecurring: form.isRecurring,
      notes: form.notes || null,
    };
    const toUpload = files;
    startTransition(async () => {
      const result =
        mode === 'edit' && entry
          ? await updateEntryAction(entry.sourceId, input)
          : await createEntryAction(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const failed: string[] = [];
      for (const file of toUpload) {
        try {
          await uploadEntryFile(result.data.id, file);
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      if (failed.length > 0) {
        setError(
          `El movimiento quedó guardado, pero no se subió: ${failed.join(' · ')} Vuelve a adjuntarlo desde la lista.`,
        );
        setFiles([]);
        router.refresh();
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const content = (
    <DialogContent className="flex max-w-2xl flex-col overflow-hidden">
      <DialogHeader className="mb-3">
        <DialogTitle>{mode === 'edit' ? 'Editar movimiento' : 'Nuevo movimiento'}</DialogTitle>
        <DialogDescription>
          {isExpense
            ? 'Un gasto de la clínica: alquiler, luz, material, la cuota… con su factura o ticket.'
            : 'Un ingreso que no viene de una cita: un bono, un producto, otra cosa.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <fieldset
          className="grid min-w-0 grid-cols-2 gap-1 rounded-[14px] bg-zinc-100 p-1"
          aria-label="Tipo"
        >
          {(['EXPENSE', 'INCOME'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={form.kind === k}
              onClick={() => switchKind(k)}
              className={cn(
                'h-10 rounded-[11px] text-[14px] font-semibold transition-colors',
                form.kind === k
                  ? k === 'EXPENSE'
                    ? 'bg-white text-rose-700 shadow-sm'
                    : 'bg-white text-emerald-700 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {k === 'EXPENSE' ? 'Gasto' : 'Ingreso'}
            </button>
          ))}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="fin-concept">Concepto</Label>
            <Input
              id="fin-concept"
              value={form.concept}
              onChange={(e) => set('concept', e.target.value)}
              placeholder={isExpense ? 'Alquiler del local · septiembre' : 'Bono de 5 sesiones'}
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-amount">Importe (€)</Label>
            <Input
              id="fin-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="450,00"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-tax">
              IVA incluido <span className="font-normal text-zinc-400">(opcional)</span>
            </Label>
            <Input
              id="fin-tax"
              inputMode="decimal"
              value={form.tax}
              onChange={(e) => set('tax', e.target.value)}
              placeholder="0,00"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-category">Categoría</Label>
            <Select
              id="fin-category"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">Sin categoría</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isFixed ? ' · fijo' : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-counterparty">{isExpense ? 'Proveedor' : 'Quién paga'}</Label>
            <Input
              id="fin-counterparty"
              value={form.counterparty}
              onChange={(e) => set('counterparty', e.target.value)}
              placeholder={isExpense ? 'Inmobiliaria Sol' : 'Familia García'}
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-occurred">
              {isExpense ? 'Fecha del gasto' : 'Fecha del ingreso'}
            </Label>
            <Input
              id="fin-occurred"
              type="date"
              value={form.occurredOn}
              onChange={(e) => set('occurredOn', e.target.value)}
            />
          </div>
          {professionals.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fin-prof">
                Profesional <span className="font-normal text-zinc-400">(opcional)</span>
              </Label>
              <Select
                id="fin-prof"
                value={form.professionalId}
                onChange={(e) => set('professionalId', e.target.value)}
              >
                <option value="">Toda la clínica</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div className="rounded-[18px] border border-(--color-border) bg-[#fafbfb] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-zinc-700">
              {isExpense ? '¿Ya está pagado?' : '¿Ya está cobrado?'}
            </span>
            <fieldset
              className="inline-flex min-w-0 items-center rounded-full border border-(--color-border) bg-white p-0.5"
              aria-label="Estado"
            >
              {(['PAID', 'PENDING'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={form.status === s}
                  onClick={() => set('status', s)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors',
                    form.status === s
                      ? 'bg-brand-100 text-brand-800'
                      : 'text-zinc-500 hover:text-zinc-800',
                  )}
                >
                  {s === 'PAID' ? 'Sí' : 'Pendiente'}
                </button>
              ))}
            </fieldset>
          </div>
          {form.status === 'PAID' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fin-paid">{isExpense ? 'Fecha de pago' : 'Fecha de cobro'}</Label>
                <Input
                  id="fin-paid"
                  type="date"
                  value={form.paidOn}
                  onChange={(e) => set('paidOn', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="fin-method">Método</Label>
                <Select
                  id="fin-method"
                  value={form.paymentMethod}
                  onChange={(e) =>
                    set('paymentMethod', e.target.value as FinancePaymentMethod | '')
                  }
                >
                  <option value="">Sin especificar</option>
                  {FINANCE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {FINANCE_PAYMENT_METHOD_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}
        </div>

        {isExpense && (
          <span className="flex items-center justify-between gap-3 rounded-[18px] border border-(--color-border) px-3.5 py-3">
            <span className="flex flex-col">
              <span className="text-[14px] font-semibold text-zinc-800">Se repite cada mes</span>
              <span className="text-[12px] text-zinc-500">
                Alquiler, cuota, seguro… Desde Movimientos se traen al mes siguiente con un clic.
              </span>
            </span>
            <Switch
              checked={form.isRecurring}
              onCheckedChange={(v) => set('isRecurring', v)}
              label="Se repite cada mes"
            />
          </span>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fin-notes">
            Notas <span className="font-normal text-zinc-400">(opcional)</span>
          </Label>
          <Textarea
            id="fin-notes"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="min-h-[72px]"
            maxLength={2000}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-brand-200 bg-white px-3.5 py-2.5 hover:bg-brand-50/50">
            <input
              type="file"
              accept={RECEIPT_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                if (picked.length) setFiles((f) => [...f, ...picked]);
                e.target.value = '';
              }}
            />
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Paperclip className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold text-zinc-800">Adjuntar comprobante</span>
              <span className="text-[12px] text-zinc-500">
                Factura, ticket o justificante · PDF o foto · hasta 15 MB cada uno
              </span>
            </span>
          </label>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] bg-zinc-100 px-2.5 py-1.5 text-[12px] text-zinc-800"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Quitar ${f.name}`}
                    onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                    className="text-zinc-400 hover:text-zinc-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === 'edit' && entry && entry.files.length > 0 && (
            <p className="text-[12px] text-zinc-500">
              Ya tiene {entry.files.length} comprobante{entry.files.length === 1 ? '' : 's'}; los
              nuevos se añaden.
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {mode === 'edit' ? 'Guardar cambios' : 'Guardar movimiento'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : openProp === undefined ? (
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4" /> Nuevo movimiento
          </Button>
        </DialogTrigger>
      ) : null}
      {content}
    </Dialog>
  );
}
