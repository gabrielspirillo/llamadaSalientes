'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/input';
import { type ChargeFileKind, RECEIPT_ACCEPT } from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import {
  DOCUMENT_KIND_GROUP_LABELS,
  type DocumentKindGroup,
  type FinanceKind,
  documentKindGroup,
  formatCents,
  formatDateKey,
} from '@/lib/finance/model';
import { FileText, FolderOpen, Upload } from 'lucide-react';
import * as React from 'react';
import {
  type EntryCategoryOption,
  type EntryCounterpartyOption,
  EntryDialog,
  type EntryProfessionalOption,
} from './entry-dialog';

export interface DocumentRow {
  id: string;
  name: string;
  kind: ChargeFileKind;
  /** 'entry' → /api/finanzas/files, 'charge' → /api/agenda/charges/files */
  source: 'entry' | 'charge';
  date: string;
  concept: string;
  entryKind: FinanceKind;
  amountCents: number | null;
  patientKey: string | null;
}

/**
 * Todos los comprobantes del período, vengan del libro o de los cobros de
 * las citas. Elegir un archivo abre el alta del gasto con el archivo ya
 * puesto: un comprobante siempre cuelga de un movimiento, no hay huérfanos.
 */
export function DocumentsPanel({
  documents,
  categories,
  professionals,
  counterparties,
  todayKey,
  canWrite,
}: {
  documents: DocumentRow[];
  categories: EntryCategoryOption[];
  professionals: EntryProfessionalOption[];
  counterparties: EntryCounterpartyOption[];
  todayKey: string;
  canWrite: boolean;
}) {
  const [group, setGroup] = React.useState<DocumentKindGroup | ''>('');
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  const rows = group ? documents.filter((d) => documentKindGroup(d.kind) === group) : documents;
  const hrefFor = (d: DocumentRow) =>
    d.source === 'entry' ? `/api/finanzas/files/${d.id}` : `/api/agenda/charges/files/${d.id}`;

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-6 sm:pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Tipo de documento"
          value={group}
          onChange={(e) => setGroup(e.target.value as DocumentKindGroup | '')}
          className="h-10 w-auto min-w-[180px] text-[13px]"
        >
          <option value="">Facturas y tickets</option>
          <option value="INVOICE">Sólo {DOCUMENT_KIND_GROUP_LABELS.INVOICE.toLowerCase()}s</option>
          <option value="RECEIPT">Sólo {DOCUMENT_KIND_GROUP_LABELS.RECEIPT.toLowerCase()}s</option>
        </Select>
        <span className="hidden text-[12px] text-zinc-600 sm:inline">
          Factura = la que pide la gestoría · Ticket o justificante = el del TPV, la captura del
          Bizum…
        </span>
        {canWrite && (
          <label className="ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-4 text-[13px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(55,118,106,0.8)] hover:brightness-105">
            <input
              type="file"
              accept={RECEIPT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setPendingFile(f);
                e.target.value = '';
              }}
            />
            <Upload className="h-4 w-4" /> Nuevo gasto con comprobante
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-5 w-5" />}
          title="Sin documentos en este período"
          description="Las facturas y tickets que adjuntes a un gasto, y los comprobantes de los cobros de las citas, aparecen aquí."
        />
      ) : (
        <ul className="divide-y divide-(--color-border-subtle) rounded-2xl border border-(--color-border)">
          {rows.map((d) => (
            <li
              key={`${d.source}:${d.id}`}
              className="flex flex-wrap items-center gap-3 px-3.5 py-2.5"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-[200px] flex-1">
                <a
                  href={hrefFor(d)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] font-semibold text-zinc-900 hover:text-brand-700"
                >
                  {d.name}
                </a>
                <p className="text-[12px] text-zinc-600">
                  {DOCUMENT_KIND_GROUP_LABELS[documentKindGroup(d.kind)]} · {formatDateKey(d.date)}{' '}
                  · {d.concept}
                </p>
              </div>
              <span
                className={cn(
                  'text-[14px] font-bold tabular-nums',
                  d.entryKind === 'INCOME' ? 'text-emerald-700' : 'text-amber-800',
                )}
              >
                {d.amountCents === null ? '—' : formatCents(d.amountCents)}
              </span>
              <Button asChild size="sm" variant="ghost">
                <a href={hrefFor(d)} target="_blank" rel="noreferrer">
                  Abrir
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}

      {pendingFile && (
        <EntryDialog
          mode="create"
          categories={categories}
          professionals={professionals}
          counterparties={counterparties}
          todayKey={todayKey}
          initialFile={pendingFile}
          open
          onOpenChange={(o) => {
            if (!o) setPendingFile(null);
          }}
        />
      )}
    </div>
  );
}
