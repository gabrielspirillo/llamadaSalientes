import { chartSequence } from '@/components/dashboard/chart-theme';
import { cn } from '@/lib/cn';
import { formatCents } from '@/lib/finance/model';

export interface BreakdownItem {
  id: string;
  name: string;
  cents: number;
  /** "12 sesiones", "fijo". */
  hint?: string | null;
  /** Índice estable de color (el de la entidad). Sin él, la fila va en tinta neutra. */
  colorIndex?: number;
}

/**
 * Lista con barras: cada fila con su parte del total. Sin dependencias: es lo
 * que se lee de un vistazo y funciona igual en móvil.
 */
export function BreakdownList({
  items,
  total,
  emptyLabel = 'Nada que repartir',
  max = 8,
}: {
  items: BreakdownItem[];
  /** Base del porcentaje. Si no se pasa, la suma de las filas. */
  total?: number;
  emptyLabel?: string;
  max?: number;
}) {
  const rows = items.filter((i) => i.cents > 0).slice(0, max);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[13px] text-zinc-400">{emptyLabel}</p>;
  }
  const base = total ?? rows.reduce((acc, r) => acc + r.cents, 0);
  const top = Math.max(1, ...rows.map((r) => r.cents));
  return (
    <ul className="space-y-2.5">
      {rows.map((item, i) => {
        const pct = base > 0 ? Math.round((item.cents / base) * 100) : 0;
        const color =
          item.colorIndex === undefined
            ? '#8a9a95'
            : chartSequence[item.colorIndex % chartSequence.length];
        return (
          <li key={item.id} className="text-[13px]">
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate font-medium text-zinc-700">{item.name}</span>
                {item.hint && (
                  <span className="shrink-0 text-[11px] text-zinc-400">{item.hint}</span>
                )}
              </span>
              <span className="shrink-0 font-bold tabular-nums text-zinc-800">
                {formatCents(item.cents)}
                <span className="ml-1.5 font-medium text-zinc-400">{pct} %</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="bar-fill h-full rounded-full"
                style={{
                  width: `${(item.cents / top) * 100}%`,
                  backgroundColor: color,
                  ['--bar-delay' as string]: `${120 + i * 70}ms`,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Una barra en dos tramos: fijos contra variables. */
export function FixedVariableBar({
  fixedCents,
  variableCents,
}: { fixedCents: number; variableCents: number }) {
  const total = fixedCents + variableCents;
  if (total === 0)
    return <p className="py-4 text-center text-[13px] text-zinc-400">Sin gastos en el período</p>;
  const fixedPct = Math.round((fixedCents / total) * 100);
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        <div className="bar-fill rounded-l-full bg-[#27403a]" style={{ width: `${fixedPct}%` }} />
        <div
          className="bar-fill rounded-r-full bg-[#9aa8a3]"
          style={{ width: `${100 - fixedPct}%` }}
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div className={cn('rounded-xl bg-[#fafbfb] p-3')}>
          <dt className="flex items-center gap-2 text-zinc-500">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#27403a]" /> Fijos ·{' '}
            {fixedPct} %
          </dt>
          <dd className="mt-1 font-bold tabular-nums text-zinc-900">{formatCents(fixedCents)}</dd>
        </div>
        <div className="rounded-xl bg-[#fafbfb] p-3">
          <dt className="flex items-center gap-2 text-zinc-500">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[#9aa8a3]" /> Variables ·{' '}
            {100 - fixedPct} %
          </dt>
          <dd className="mt-1 font-bold tabular-nums text-zinc-900">
            {formatCents(variableCents)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
