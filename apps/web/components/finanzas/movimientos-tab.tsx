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
  sortLedger,
} from '@/lib/finance/model';
import type { FinanceParams } from '@/lib/finance/params';
import type { FinanceCategoryRecord, FinanceProfessional } from '@/lib/finance/queries';
import { BookOpen } from 'lucide-react';

/** La pestaña Movimientos: el libro con todos los filtros y las acciones por línea. */
export function MovimientosTab({
  params,
  ledger,
  categories,
  professionals,
  todayKey,
  canWrite,
  canManage,
}: {
  params: FinanceParams;
  ledger: LedgerLine[];
  categories: FinanceCategoryRecord[];
  professionals: FinanceProfessional[];
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
  let pending = 0;
  for (const l of lines) {
    if (l.amountCents === null) continue;
    if (l.status === 'PENDING') pending += 1;
    if (l.kind === 'INCOME') income += l.amountCents;
    else expense += l.amountCents;
  }

  const activeCategories = categories.filter((c) => c.active);

  return (
    <>
      <FinanceFilters
        params={params}
        categories={activeCategories}
        professionals={professionals}
        show={{
          basis: true,
          kind: true,
          status: true,
          category: true,
          professional: true,
          method: true,
          source: true,
          q: true,
        }}
      />

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-(--color-border-subtle) bg-(--color-border-subtle) sm:grid-cols-4">
        <Total label="Ingresos" value={formatCents(income)} tone="income" />
        <Total label="Gastos" value={formatCents(expense)} />
        <Total
          label="Neto"
          value={formatCents(income - expense)}
          tone={income - expense >= 0 ? 'income' : 'due'}
        />
        <Total
          label="Movimientos"
          value={`${lines.length}${pending ? ` · ${pending} pendiente${pending === 1 ? '' : 's'}` : ''}`}
        />
      </dl>

      <Card>
        <CardTopbar
          icon={<BookOpen className="h-4 w-4" />}
          tone="grape"
          title="Libro de movimientos"
          subtitle="Los cobros de las citas se editan desde la ficha del paciente; el resto, aquí"
        />
        <div className="px-4 pb-5 sm:px-6 sm:pb-6">
          <LedgerTable
            lines={lines}
            categories={activeCategories}
            professionals={professionals.filter((p) => p.active)}
            todayKey={todayKey}
            basis={params.basis}
            canWrite={canWrite}
            canManage={canManage}
            monthKey={monthKeyOf(todayKey)}
          />
        </div>
      </Card>
    </>
  );
}

function Total({
  label,
  value,
  tone = 'default',
}: { label: string; value: string; tone?: 'default' | 'income' | 'due' }) {
  return (
    <div className="flex flex-col gap-[3px] bg-[#fbfcfc] px-3.5 py-3">
      <dt className="text-[12px] font-semibold text-zinc-600">{label}</dt>
      <dd
        className={cn(
          'text-[15px] font-bold tabular-nums md:text-[18px]',
          tone === 'income'
            ? 'text-emerald-700'
            : tone === 'due'
              ? 'text-rose-700'
              : 'text-zinc-900',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
