import { FinanceFilters } from '@/components/finanzas/finance-filters';
import { LedgerTable } from '@/components/finanzas/ledger-table';
import { Card, CardTopbar } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import {
  type LedgerLine,
  formatCents,
  linesTouchingRange,
  matchesFilters,
  monthKeyOf,
  plural,
  sortLedger,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import type {
  CounterpartySuggestion,
  FinanceCategoryRecord,
  FinanceProfessional,
} from '@/lib/finance/queries';
import { BookOpen } from 'lucide-react';

/** Misma barra de filtros en Movimientos y Documentos: lo que cambia es la lista, no cómo se acota. */
export const LEDGER_FILTERS = {
  basis: true,
  kind: true,
  status: true,
  category: true,
  professional: true,
  method: true,
  source: true,
  q: true,
} as const;

/** La pestaña Movimientos: el libro con todos los filtros y las acciones por línea. */
export function MovimientosTab({
  params,
  ledger,
  categories,
  professionals,
  counterparties,
  recurring,
  todayKey,
  canWrite,
  canManage,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
  counterparties: CounterpartySuggestion[];
  recurring: { candidates: number; alreadyCopied: number };
  todayKey: string;
  canWrite: boolean;
  canManage: boolean;
}) {
  const lines = sortLedger(
    linesTouchingRange(ledger, params.period).filter((l) => matchesFilters(l, params.filters)),
    params.basis,
  );
  let income = 0;
  let expense = 0;
  let pendingCount = 0;
  for (const l of lines) {
    if (l.amountCents === null) continue;
    if (l.status === 'PENDING') pendingCount += 1;
    if (l.kind === 'INCOME') income += l.amountCents;
    else expense += l.amountCents;
  }
  const net = income - expense;
  const activeCategories = categories.filter((c) => c.active);

  return (
    <>
      <FinanceFilters
        params={params}
        categories={activeCategories}
        professionals={professionals}
        show={LEDGER_FILTERS}
      />

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-(--color-border-subtle) bg-(--color-border-subtle) sm:grid-cols-4">
        <Total
          label="Ingresos"
          value={formatCents(income)}
          tone={income > 0 ? 'income' : 'neutral'}
        />
        <Total
          label="Gastos"
          value={formatCents(expense)}
          tone={expense > 0 ? 'expense' : 'neutral'}
        />
        <Total
          label="Neto"
          value={formatCents(net)}
          tone={net > 0 ? 'income' : net < 0 ? 'negative' : 'neutral'}
        />
        <Total
          label="Movimientos"
          value={`${lines.length}${pendingCount ? ` · ${plural(pendingCount, 'pendiente', 'pendientes')}` : ''}`}
          tone="neutral"
        />
      </dl>

      <Card>
        <CardTopbar
          icon={<BookOpen className="h-4 w-4" />}
          tone="grape"
          title="Libro de movimientos"
          subtitle="Los cobros de las citas (con candado) se editan desde la ficha del paciente; el resto, aquí"
        />
        <div className="px-4 pb-5 sm:px-6 sm:pb-6">
          <LedgerTable
            lines={lines}
            categories={activeCategories}
            professionals={professionals.filter((p) => p.active)}
            counterparties={counterparties}
            todayKey={todayKey}
            basis={params.basis}
            canWrite={canWrite}
            canManage={canManage}
            monthKey={monthKeyOf(todayKey)}
            recurring={recurring}
          />
        </div>
      </Card>
    </>
  );
}

function Total({
  label,
  value,
  tone,
}: { label: string; value: string; tone: 'neutral' | 'income' | 'expense' | 'negative' }) {
  return (
    <div className="flex flex-col gap-[3px] bg-[#fbfcfc] px-3.5 py-3">
      <dt className="text-[12px] font-semibold text-zinc-700">{label}</dt>
      <dd
        className={cn(
          'text-[15px] font-bold tabular-nums md:text-[18px]',
          tone === 'income'
            ? 'text-emerald-700'
            : tone === 'expense'
              ? 'text-amber-800'
              : tone === 'negative'
                ? 'text-rose-700'
                : 'text-zinc-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
