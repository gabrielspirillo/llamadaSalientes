'use client';

import {
  createCategoryAction,
  reorderCategoriesAction,
  updateCategoryAction,
} from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { type FinanceKind, plural } from '@/lib/finance/model';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Pencil,
  Plus,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface CategoryRow {
  id: string;
  kind: FinanceKind;
  name: string;
  isFixed: boolean;
  active: boolean;
  isSystem: boolean;
}

/**
 * Las categorías de la clínica. Lo importante está en la casilla FIJO: es lo
 * que decide qué gastos entran en el punto de equilibrio. Todo se guarda al
 * momento y se dice ("Guardado"). Las archivadas tienen su propia sección,
 * desde donde se recuperan; no se borran: un gasto de hace meses sigue
 * apuntando a ellas.
 */
export function CategoriesPanel({
  kind,
  categories,
  counts,
}: {
  kind: FinanceKind;
  categories: CategoryRow[];
  /** Movimientos por categoría, para saber qué se usa. */
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState('');
  const [isFixed, setIsFixed] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const savedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const active = categories.filter((c) => c.kind === kind && c.active);
  const archived = categories.filter((c) => c.kind === kind && !c.active);

  // Orden local para que la flecha responda al instante; el servidor confirma.
  const [order, setOrder] = React.useState(active.map((c) => c.id));
  const activeKey = active.map((c) => c.id).join(',');
  React.useEffect(() => {
    setOrder(activeKey ? activeKey.split(',') : []);
  }, [activeKey]);
  const ordered = order
    .map((id) => active.find((c) => c.id === id))
    .filter((c): c is CategoryRow => Boolean(c));

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2200);
  }
  React.useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'No se pudo completar.');
        return;
      }
      flashSaved();
      router.refresh();
    });
  }

  function move(id: string, dir: -1 | 1) {
    const idx = order.indexOf(id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[idx], next[target]] = [next[target] as string, next[idx] as string];
    setOrder(next);
    run(() => reorderCategoriesAction(kind, next));
  }

  const isExpense = kind === 'EXPENSE';

  return (
    <div className="flex flex-col gap-3 p-4 sm:p-6 sm:pt-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(async () => {
            const r = await createCategoryAction({ kind, name, isFixed });
            if (r.ok) {
              setName('');
              setIsFixed(false);
            }
            return r;
          });
        }}
      >
        <label
          htmlFor={`fin-cat-new-${kind}`}
          className="flex min-w-[200px] flex-1 flex-col gap-1 text-[12px] font-semibold text-zinc-700"
        >
          Nueva categoría
          <Input
            id={`fin-cat-new-${kind}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isExpense ? 'Ej.: Ropa de trabajo' : 'Ej.: Talleres para familias'}
            maxLength={80}
            className="h-10 placeholder:text-zinc-400/80"
          />
        </label>
        {isExpense && (
          <span className="flex h-10 items-center gap-2 text-[13px] font-medium text-zinc-700">
            <Switch checked={isFixed} onCheckedChange={setIsFixed} label="Coste fijo" /> Fijo
          </span>
        )}
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Añadir
        </Button>
      </form>

      <div className="flex min-h-5 items-center gap-2 text-[12px]" aria-live="polite">
        {saved && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Guardado
          </span>
        )}
        {error && (
          <span role="alert" className="inline-flex items-center gap-1 text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </span>
        )}
      </div>

      <ul className="divide-y divide-(--color-border-subtle) rounded-2xl border border-(--color-border)">
        {ordered.map((c, i) => {
          const isEditing = editing?.id === c.id;
          const count = counts[c.id] ?? 0;
          return (
            <li
              key={c.id}
              className="grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-2 px-2.5 py-2"
            >
              <span className="flex flex-col">
                <button
                  type="button"
                  aria-label={`Subir ${c.name}`}
                  disabled={pending || i === 0}
                  onClick={() => move(c.id, -1)}
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${c.name}`}
                  disabled={pending || i === ordered.length - 1}
                  onClick={() => move(c.id, 1)}
                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </span>
              {isEditing ? (
                <form
                  className="flex min-w-0 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      const r = await updateCategoryAction(c.id, { name: editing.name });
                      if (r.ok) setEditing(null);
                      return r;
                    });
                  }}
                >
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    className="h-9"
                    maxLength={80}
                    autoFocus
                  />
                  <Button type="submit" size="sm" disabled={pending} aria-label="Guardar nombre">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-zinc-800">
                    {c.name}
                  </span>
                  <span className="text-[11px] text-zinc-600">
                    {count === 0 ? 'Sin movimientos' : plural(count, 'movimiento', 'movimientos')}
                  </span>
                </span>
              )}
              {/* Columna Fijo: en ingresos queda un hueco del mismo ancho para que las listas alineen. */}
              <span className="flex w-[64px] items-center justify-end gap-2 text-[12px] font-semibold text-zinc-700">
                {isExpense ? (
                  <>
                    <Switch
                      checked={c.isFixed}
                      disabled={pending}
                      onCheckedChange={(v) => run(() => updateCategoryAction(c.id, { isFixed: v }))}
                      label={`${c.name}: coste fijo`}
                    />
                    Fijo
                  </>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || isEditing}
                aria-label={`Renombrar ${c.name}`}
                onClick={() => setEditing({ id: c.id, name: c.name })}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-label={`Archivar ${c.name}`}
                title="Archivar (no se borra: se puede recuperar)"
                onClick={() => {
                  if (
                    !window.confirm(
                      `¿Archivar «${c.name}»? Deja de ofrecerse al cargar movimientos; los que ya la usan no cambian y se puede recuperar.`,
                    )
                  )
                    return;
                  run(() => updateCategoryAction(c.id, { active: false }));
                }}
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </li>
          );
        })}
        {ordered.length === 0 && (
          <li className="px-3.5 py-6 text-center text-[13px] text-zinc-600">Sin categorías.</li>
        )}
      </ul>

      {archived.length > 0 && (
        <details className="rounded-2xl border border-dashed border-(--color-border) px-3.5 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-zinc-700">
            Archivadas ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-(--color-border-subtle)">
            {archived.map((c) => (
              <li
                key={c.id}
                className={cn('flex items-center gap-2 py-2 text-[13px] text-zinc-600')}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[11px]">
                  {plural(counts[c.id] ?? 0, 'movimiento', 'movimientos')}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => updateCategoryAction(c.id, { active: true }))}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" /> Recuperar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
