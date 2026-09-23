import { type DocumentRow, DocumentsPanel } from '@/components/finanzas/documents-panel';
import { FinanceFilters } from '@/components/finanzas/finance-filters';
import { LEDGER_FILTERS } from '@/components/finanzas/movimientos-tab';
import { Card, CardTopbar } from '@/components/ui/card';
import {
  type LedgerLine,
  linesTouchingRange,
  matchesFilters,
  plural,
  sortLedger,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import type {
  CounterpartySuggestion,
  FinanceCategoryRecord,
  FinanceProfessional,
} from '@/lib/finance/queries';
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
  counterparties,
  todayKey,
  canWrite,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  counterparties: CounterpartySuggestion[];
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
      {/* Misma barra que Movimientos: lo que cambia es la lista, no cómo se acota. */}
      <FinanceFilters
        params={params}
        categories={activeCategories}
        professionals={professionals}
        show={LEDGER_FILTERS}
      />
      <Card>
        <CardTopbar
          icon={<FolderOpen className="h-4 w-4" />}
          tone="sky"
          title="Facturas y comprobantes"
          subtitle={`${plural(documents.length, 'documento', 'documentos')} en ${params.period.label}`}
        />
        <DocumentsPanel
          documents={documents}
          categories={activeCategories}
          professionals={professionals.filter((p) => p.active)}
          counterparties={counterparties}
          todayKey={todayKey}
          canWrite={canWrite}
        />
      </Card>
    </>
  );
}
