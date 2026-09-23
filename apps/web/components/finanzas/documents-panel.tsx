'use client';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/input';
import {
  CHARGE_FILE_KINDS,
  CHARGE_FILE_KIND_LABELS,
  type ChargeFileKind,
  RECEIPT_ACCEPT,
} from '@/lib/agenda/billing';
import { cn } from '@/lib/cn';
import { type FinanceKind, formatCents, formatDateKey } from '@/lib/finance/model';
import { FileText, FolderOpen, Upload } from 'lucide-react';
import * as React from 'react';
import {
  type EntryCategoryOption,
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
 * las citas, con un buzón para subir uno nuevo: elegir el archivo abre el
 * alta de movimiento con el archivo ya puesto, para que no exista un
 * comprobante sin su gasto.
 */
export function DocumentsPanel({
  documents,
  categories,
  professionals,
  todayKey,
  canWrite,
}: {
  documents: DocumentRow[];
  categories: EntryCategoryOption[];
  professionals: EntryProfessionalOption[];
  todayKey: string;
  canWrite: boolean;
}) {
  const [kind, setKind] = React.useState<ChargeFileKind | ''>('');
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  const rows = kind ? documents.filter((d) => d.kind === kind) : documents;

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-6 sm:pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Tipo de documento"
          value={kind}
          onChange={(e) => setKind(e.target.value as ChargeFileKind | '')}
          className="h-10 w-auto min-w-[160px] text-[13px]"
        >
          <option value="">Todos los tipos</option>
          {CHARGE_FILE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHARGE_FILE_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
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
            <Upload className="h-4 w-4" /> Subir comprobante
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
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-[200px] flex-1">
                <a
                  href={
                    d.source === 'entry'
                      ? `/api/finanzas/files/${d.id}`
                      : `/api/agenda/charges/files/${d.id}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] font-semibold text-zinc-900 hover:text-brand-700"
                >
                  {d.name}
                </a>
                <p className="text-[12px] text-zinc-500">
                  {CHARGE_FILE_KIND_LABELS[d.kind]} · {formatDateKey(d.date)} · {d.concept}
                </p>
              </div>
              <span
                className={cn(
                  'text-[14px] font-bold tabular-nums',
                  d.entryKind === 'INCOME' ? 'text-emerald-700' : 'text-zinc-900',
                )}
              >
                {d.amountCents === null ? '—' : formatCents(d.amountCents)}
              </span>
              <Button asChild size="sm" variant="ghost">
                <a
                  href={
                    d.source === 'entry'
                      ? `/api/finanzas/files/${d.id}`
                      : `/api/agenda/charges/files/${d.id}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
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
