import { type DocumentRow, DocumentsPanel } from '@/components/finanzas/documents-panel';
import { FinanceFilters } from '@/components/finanzas/finance-filters';
import { Card, CardTopbar } from '@/components/ui/card';
import {
  type LedgerLine,
  linesTouchingRange,
  matchesFilters,
  sortLedger,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import type { FinanceCategoryRecord, FinanceProfessional } from '@/lib/finance/queries';
import { FolderOpen } from 'lucide-react';

/** Los comprobantes de un período, vengan del libro o de los cobros de las citas. */
export function documentsFromLedger(lines: LedgerLine[]): DocumentRow[] {
  const out: DocumentRow[] = [];
  for (const l of lines) {
    if (l.source === 'appointment') continue;
    for (const f of l.files) {
      out.push({
        id: f.id,
        name: f.name,
        kind: f.kind,
        source: l.source === 'entry' ? 'entry' : 'charge',
        date: l.paidOn ?? l.occurredOn,
        concept: l.patientName ? `${l.patientName} · ${l.concept}` : l.concept,
        entryKind: l.kind,
        amountCents: l.amountCents,
        patientKey: l.patientKey,
      });
    }
  }
  return out;
}

export function DocumentosTab({
  params,
  ledger,
  categories,
  professionals,
  todayKey,
  canWrite,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  todayKey: string;
  canWrite: boolean;
}) {
  const lines = sortLedger(
    linesTouchingRange(ledger, params.period).filter((l) => matchesFilters(l, params.filters)),
    params.basis,
  );
  const documents = documentsFromLedger(lines);
  const activeCategories = categories.filter((c) => c.active);
  return (
    <>
      <FinanceFilters
        params={params}
        categories={activeCategories}
        professionals={professionals}
        show={{ kind: true, category: true, source: true, q: true }}
      />
      <Card>
        <CardTopbar
          icon={<FolderOpen className="h-4 w-4" />}
          tone="sky"
          title="Facturas y comprobantes"
          subtitle={`${documents.length} documento${documents.length === 1 ? '' : 's'} en ${params.period.label}`}
        />
        <DocumentsPanel
          documents={documents}
          categories={activeCategories}
          professionals={professionals.filter((p) => p.active)}
          todayKey={todayKey}
          canWrite={canWrite}
        />
      </Card>
    </>
  );
}
