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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { RECEIPT_ACCEPT, centsToInput, parseAmountToCents } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_RECURRENCES,
  FINANCE_RECURRENCE_LABELS,
  type FinanceKind,
  type FinancePaymentMethod,
  type FinanceRecurrence,
  type FinanceStatus,
  type LedgerLine,
  VAT_RATES,
  isDateKey,
  isFinancePaymentMethod,
  taxFromGross,
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

export interface EntryCounterpartyOption {
  name: string;
  kind: FinanceKind;
  categoryId: string | null;
}

type VatMode = '' | '21' | '10' | '4' | '0' | 'custom';

interface FormState {
  kind: FinanceKind;
  concept: string;
  categoryId: string;
  counterparty: string;
  amount: string;
  vatMode: VatMode;
  tax: string;
  occurredOn: string;
  status: FinanceStatus;
  /** "Se pagó otro día": si no, la fecha de pago es la del movimiento. */
  paidElsewhen: boolean;
  paidOn: string;
  paymentMethod: FinancePaymentMethod | '';
  professionalId: string;
  recurrence: FinanceRecurrence | '';
  notes: string;
}

type FieldErrors = Partial<Record<'concept' | 'amount' | 'tax' | 'occurredOn' | 'paidOn', string>>;

const LAST_METHOD_KEY = (kind: FinanceKind) => `finanzas:ultimo-metodo:${kind}`;

function rememberedMethod(kind: FinanceKind): FinancePaymentMethod | '' {
  try {
    const v = localStorage.getItem(LAST_METHOD_KEY(kind));
    return isFinancePaymentMethod(v) ? v : '';
  } catch {
    return '';
  }
}

function rememberMethod(kind: FinanceKind, method: FinancePaymentMethod | '') {
  try {
    if (method) localStorage.setItem(LAST_METHOD_KEY(kind), method);
  } catch {
    // Sin almacenamiento no se recuerda; no pasa nada.
  }
}

/** Con qué tipo de IVA cuadra un importe y su IVA ya guardados. */
function vatModeFor(amountCents: number, taxCents: number): VatMode {
  if (taxCents <= 0) return '';
  for (const rate of VAT_RATES) {
    if (rate > 0 && taxFromGross(amountCents, rate) === taxCents) return String(rate) as VatMode;
  }
  return 'custom';
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
      vatMode: entry.amountCents === null ? '' : vatModeFor(entry.amountCents, entry.taxCents),
      tax: entry.taxCents > 0 ? centsToInput(entry.taxCents) : '',
      occurredOn: entry.occurredOn,
      status: entry.status,
      paidElsewhen:
        entry.status === 'PAID' && entry.paidOn !== null && entry.paidOn !== entry.occurredOn,
      paidOn: entry.paidOn ?? entry.occurredOn,
      paymentMethod: entry.paymentMethod ?? '',
      professionalId: entry.professionalId ?? '',
      recurrence: entry.recurrence ?? '',
      notes: entry.notes ?? '',
    };
  }
  return {
    kind: defaultKind,
    concept: '',
    categoryId: '',
    counterparty: '',
    amount: '',
    vatMode: '',
    tax: '',
    occurredOn: todayKey,
    status: 'PAID',
    paidElsewhen: false,
    paidOn: todayKey,
    paymentMethod: rememberedMethod(defaultKind),
    professionalId: '',
    recurrence: '',
    notes: '',
  };
}

/**
 * Alta y edición de un movimiento del libro: gasto o ingreso, con su
 * comprobante arriba (muchas veces es por donde se empieza), categoría,
 * importe con el IVA calculado, fechas, método, proveedor y recurrencia.
 *
 * El movimiento va por Server Action y los archivos, después, por el endpoint
 * de subida: un archivo no cabe en una acción. Si el movimiento entra y un
 * archivo no, se dice tal cual: el movimiento no se pierde. Un comprobante
 * siempre cuelga de un movimiento: no hay documentos huérfanos.
 *
 * Controlado (`open`/`onOpenChange`) o con `trigger` propio.
 */
export function EntryDialog({
  mode,
  entry,
  categories,
  professionals,
  counterparties = [],
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
  counterparties?: EntryCounterpartyOption[];
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
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [savedCount, setSavedCount] = React.useState(0);
  const conceptRef = React.useRef<HTMLInputElement>(null);
  const datalistId = React.useId();

  // Cada apertura parte limpia (o de la fila a editar): el estado de la
  // anterior no puede colarse en la siguiente.
  React.useEffect(() => {
    if (!open) return;
    setForm(initialState(todayKey, defaultKind, entry));
    setFiles(initialFile ? [initialFile] : []);
    setErrors({});
    setError(null);
    setNotice(null);
    setSavedCount(0);
  }, [open, todayKey, defaultKind, entry, initialFile]);

  const isExpense = form.kind === 'EXPENSE';
  const categoryOptions = categories.filter((c) => c.kind === form.kind);
  const counterpartyOptions = counterparties.filter((c) => c.kind === form.kind);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function switchKind(kind: FinanceKind) {
    setErrors({});
    setError(null);
    setForm((f) => ({
      ...f,
      kind,
      categoryId: '',
      paymentMethod: rememberedMethod(kind),
      recurrence: '',
    }));
  }

  /** El IVA se recalcula cuando cambia el importe o el tipo. */
  function applyVat(amount: string, mode: VatMode, customTax: string): string {
    if (mode === '') return '';
    if (mode === 'custom') return customTax;
    const cents = parseAmountToCents(amount);
    if (cents === null) return '';
    return centsToInput(taxFromGross(cents, Number(mode)));
  }

  function onAmountChange(amount: string) {
    setForm((f) => ({ ...f, amount, tax: applyVat(amount, f.vatMode, f.tax) }));
    if (errors.amount) setErrors((e) => ({ ...e, amount: undefined }));
  }

  function onVatModeChange(mode: VatMode) {
    setForm((f) => ({
      ...f,
      vatMode: mode,
      tax: applyVat(f.amount, mode, mode === 'custom' ? f.tax : ''),
    }));
  }

  function onCounterpartyChange(value: string) {
    setForm((f) => {
      const known = counterpartyOptions.find(
        (c) => c.name.toLowerCase() === value.trim().toLowerCase(),
      );
      const categoryId =
        f.categoryId ||
        (known?.categoryId && categoryOptions.some((c) => c.id === known.categoryId)
          ? known.categoryId
          : f.categoryId);
      return { ...f, counterparty: value, categoryId };
    });
  }

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!form.concept.trim()) next.concept = 'Escribe el concepto.';
    const amountCents = parseAmountToCents(form.amount);
    if (amountCents === null) next.amount = 'Escribe el importe, por ejemplo 45 o 45,50.';
    if (form.tax.trim()) {
      const taxCents = parseAmountToCents(form.tax);
      if (taxCents === null) next.tax = 'El IVA no es un importe válido.';
      else if (amountCents !== null && taxCents > amountCents)
        next.tax = 'El IVA no puede superar el importe.';
    }
    if (!isDateKey(form.occurredOn)) next.occurredOn = 'Elige la fecha.';
    if (form.status === 'PAID' && form.paidElsewhen && !isDateKey(form.paidOn)) {
      next.paidOn = isExpense ? 'Elige la fecha de pago.' : 'Elige la fecha de cobro.';
    }
    return next;
  }

  function submit(andAnother = false) {
    const next = validate();
    setErrors(next);
    setError(null);
    setNotice(null);
    if (Object.keys(next).length > 0) {
      if (next.concept) conceptRef.current?.focus();
      return;
    }
    const input: EntryFormInput = {
      kind: form.kind,
      concept: form.concept,
      categoryId: form.categoryId || null,
      counterparty: form.counterparty || null,
      amount: form.amount,
      tax: form.tax || null,
      occurredOn: form.occurredOn,
      status: form.status,
      paidOn: form.status === 'PAID' ? (form.paidElsewhen ? form.paidOn : form.occurredOn) : null,
      paymentMethod: form.status === 'PAID' && form.paymentMethod ? form.paymentMethod : null,
      professionalId: form.professionalId || null,
      recurrence: form.recurrence || null,
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
      rememberMethod(form.kind, form.paymentMethod);
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
      if (andAnother) {
        // Se conserva lo que suele repetirse (tipo, fecha, método) y se limpia el resto.
        setForm((f) => ({
          ...initialState(todayKey, f.kind, null),
          occurredOn: f.occurredOn,
          paymentMethod: f.paymentMethod,
          status: f.status,
        }));
        setFiles([]);
        setSavedCount((n) => n + 1);
        setNotice('Guardado. Puedes cargar el siguiente.');
        router.refresh();
        conceptRef.current?.focus();
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const fieldError = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p className="flex items-center gap-1 text-[12px] font-medium text-rose-700" role="alert">
        <AlertTriangle className="h-3.5 w-3.5" /> {errors[key]}
      </p>
    ) : null;
  const invalid = (key: keyof FieldErrors) =>
    errors[key] ? 'border-rose-400 focus-visible:ring-rose-500/20' : undefined;

  const content = (
    <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-2xl flex-col overflow-hidden">
      <DialogHeader className="mb-3 shrink-0">
        <DialogTitle>{mode === 'edit' ? 'Editar movimiento' : 'Nuevo movimiento'}</DialogTitle>
        <DialogDescription>
          {isExpense
            ? 'Un gasto de la clínica: alquiler, luz, material, la cuota… con su factura o ticket.'
            : 'Un ingreso que no viene de una cita: un bono, un producto, otra cosa.'}
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1 pb-2">
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
                    ? 'bg-white text-amber-800 shadow-sm'
                    : 'bg-white text-emerald-700 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900',
              )}
            >
              {k === 'EXPENSE' ? 'Gasto' : 'Ingreso'}
            </button>
          ))}
        </fieldset>

        {/* El comprobante, arriba: es lo que se tiene en la mano. */}
        <div className="flex flex-col gap-2">
          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-[14px] border border-dashed border-brand-300 bg-brand-50/40 px-3.5 py-2.5 hover:bg-brand-50">
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
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 ring-1 ring-brand-200">
              <Paperclip className="h-4 w-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-semibold text-zinc-900">
                {files.length > 0 ? 'Añadir otro comprobante' : 'Adjuntar la factura o el ticket'}
              </span>
              <span className="text-[12px] text-zinc-600">
                PDF o foto, hasta 15 MB cada uno. Queda unido a este movimiento.
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
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                  <span className="truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Quitar ${f.name}`}
                    onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                    className="text-zinc-500 hover:text-zinc-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mode === 'edit' && entry && entry.files.length > 0 && (
            <p className="text-[12px] text-zinc-600">
              Ya tiene {entry.files.length} comprobante{entry.files.length === 1 ? '' : 's'}; los
              nuevos se añaden.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="fin-concept">Concepto</Label>
            <Input
              ref={conceptRef}
              id="fin-concept"
              value={form.concept}
              onChange={(e) => {
                set('concept', e.target.value);
                if (errors.concept) setErrors((er) => ({ ...er, concept: undefined }));
              }}
              placeholder={
                isExpense ? 'Ej.: Alquiler del local · septiembre' : 'Ej.: Bono de 5 sesiones'
              }
              maxLength={200}
              aria-invalid={Boolean(errors.concept)}
              className={cn('placeholder:text-zinc-400/80', invalid('concept'))}
            />
            {fieldError('concept')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-amount">Importe (€, IVA incluido)</Label>
            <Input
              id="fin-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="Ej.: 450,00"
              aria-invalid={Boolean(errors.amount)}
              className={cn('placeholder:text-zinc-400/80', invalid('amount'))}
            />
            {fieldError('amount')}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-vat">IVA</Label>
            <div className="flex gap-2">
              <Select
                id="fin-vat"
                value={form.vatMode}
                onChange={(e) => onVatModeChange(e.target.value as VatMode)}
                className="min-w-0 flex-1"
              >
                <option value="">Sin desglosar</option>
                <option value="21">21 %</option>
                <option value="10">10 %</option>
                <option value="4">4 %</option>
                <option value="0">Exento (0 %)</option>
                <option value="custom">Otro importe</option>
              </Select>
              {form.vatMode === 'custom' ? (
                <Input
                  aria-label="Importe del IVA"
                  inputMode="decimal"
                  value={form.tax}
                  onChange={(e) => set('tax', e.target.value)}
                  placeholder="Ej.: 78,10"
                  className={cn('w-[120px] placeholder:text-zinc-400/80', invalid('tax'))}
                />
              ) : form.vatMode !== '' ? (
                <span className="inline-flex h-11 min-w-[96px] items-center justify-end rounded-[14px] bg-zinc-100 px-3 text-[14px] font-semibold tabular-nums text-zinc-800">
                  {form.tax ? `${form.tax} €` : '—'}
                </span>
              ) : null}
            </div>
            {fieldError('tax')}
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
              list={datalistId}
              value={form.counterparty}
              onChange={(e) => onCounterpartyChange(e.target.value)}
              placeholder={isExpense ? 'Ej.: Inmobiliaria Sol' : 'Ej.: Familia García'}
              maxLength={200}
              className="placeholder:text-zinc-400/80"
            />
            <datalist id={datalistId}>
              {counterpartyOptions.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-occurred">
              {isExpense ? 'Fecha del gasto' : 'Fecha del ingreso'}
            </Label>
            <Input
              id="fin-occurred"
              type="date"
              value={form.occurredOn}
              onChange={(e) => {
                set('occurredOn', e.target.value);
                if (errors.occurredOn) setErrors((er) => ({ ...er, occurredOn: undefined }));
              }}
              aria-invalid={Boolean(errors.occurredOn)}
              className={invalid('occurredOn')}
            />
            {fieldError('occurredOn')}
          </div>
          {professionals.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fin-prof">
                Profesional <span className="font-normal text-zinc-500">(opcional)</span>
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
            <span className="text-[13px] font-semibold text-zinc-800">Estado</span>
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
                      : 'text-zinc-600 hover:text-zinc-900',
                  )}
                >
                  {s === 'PAID' ? (isExpense ? 'Pagado' : 'Cobrado') : 'Pendiente'}
                </button>
              ))}
            </fieldset>
          </div>
          {form.status === 'PAID' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-zinc-700">
                  <input
                    type="checkbox"
                    checked={form.paidElsewhen}
                    onChange={(e) => set('paidElsewhen', e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 accent-brand-600"
                    id="fin-paid-elsewhen"
                  />
                  <label htmlFor="fin-paid-elsewhen">
                    {isExpense ? 'Se pagó otro día' : 'Se cobró otro día'}
                  </label>
                </span>
                {form.paidElsewhen ? (
                  <>
                    <Input
                      aria-label={isExpense ? 'Fecha de pago' : 'Fecha de cobro'}
                      type="date"
                      value={form.paidOn}
                      onChange={(e) => {
                        set('paidOn', e.target.value);
                        if (errors.paidOn) setErrors((er) => ({ ...er, paidOn: undefined }));
                      }}
                      aria-invalid={Boolean(errors.paidOn)}
                      className={invalid('paidOn')}
                    />
                    {fieldError('paidOn')}
                  </>
                ) : (
                  <p className="text-[12px] text-zinc-600">
                    {isExpense ? 'Se toma la fecha del gasto.' : 'Se toma la fecha del ingreso.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-recurrence">Se repite</Label>
            <Select
              id="fin-recurrence"
              value={form.recurrence}
              onChange={(e) => set('recurrence', e.target.value as FinanceRecurrence | '')}
            >
              <option value="">No se repite</option>
              {FINANCE_RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {FINANCE_RECURRENCE_LABELS[r]}
                </option>
              ))}
            </Select>
            <p className="text-[12px] text-zinc-600">
              Alquiler, cuota, seguro, IBI… Desde Movimientos se traen al mes que toca con un clic.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fin-notes">
              Notas <span className="font-normal text-zinc-500">(opcional)</span>
            </Label>
            <Textarea
              id="fin-notes"
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="min-h-[72px]"
              maxLength={2000}
            />
          </div>
        </div>

        {notice && (
          <p className="flex items-start gap-2 rounded-[14px] bg-emerald-50 p-3 text-[13px] text-emerald-800">
            <Check className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
            {savedCount > 1 ? ` (${savedCount} en esta tanda)` : ''}
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
      </div>

      {/* Pie fijo: Guardar siempre a la vista, aunque el formulario sea largo. */}
      <div className="mt-3 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-(--color-border-subtle) pt-4">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancelar
        </Button>
        {mode === 'create' && (
          <Button variant="secondary" onClick={() => submit(true)} disabled={pending}>
            <Plus className="h-4 w-4" /> Guardar y cargar otro
          </Button>
        )}
        <Button onClick={() => submit(false)} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {mode === 'edit' ? 'Guardar cambios' : 'Guardar'}
        </Button>
      </div>
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
