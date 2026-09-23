'use client';

import {
  createCategoryAction,
  updateCategoryAction,
} from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Switch } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { FinanceKind } from '@/lib/finance/model';
import { AlertTriangle, Archive, ArchiveRestore, Check, Loader2, Pencil, Plus } from 'lucide-react';
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
 * que decide qué gastos entran en el punto de equilibrio. Las sembradas por
 * la plataforma se renombran o se archivan, no se borran: un gasto de hace
 * meses sigue apuntando a ellas.
 */
export function CategoriesPanel({
  kind,
  categories,
}: { kind: FinanceKind; categories: CategoryRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState('');
  const [isFixed, setIsFixed] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  const rows = categories.filter((c) => c.kind === kind && (showArchived || c.active));
  const archivedCount = categories.filter((c) => c.kind === kind && !c.active).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? 'No se pudo completar.');
        return;
      }
      router.refresh();
    });
  }

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
          htmlFor="fin-cat-new"
          className="flex min-w-[200px] flex-1 flex-col gap-1 text-[12px] font-semibold text-zinc-600"
        >
          Nueva categoría
          <Input
            id="fin-cat-new"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === 'EXPENSE' ? 'Ropa de trabajo' : 'Talleres para familias'}
            maxLength={80}
            className="h-10"
          />
        </label>
        {kind === 'EXPENSE' && (
          <span className="flex h-10 items-center gap-2 text-[13px] font-medium text-zinc-700">
            <Switch checked={isFixed} onCheckedChange={setIsFixed} label="Coste fijo" /> Fijo
          </span>
        )}
        <Button type="submit" size="sm" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Añadir
        </Button>
      </form>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <ul className="divide-y divide-(--color-border-subtle) rounded-2xl border border-(--color-border)">
        {rows.map((c) => {
          const isEditing = editing?.id === c.id;
          return (
            <li
              key={c.id}
              className={cn(
                'flex flex-wrap items-center gap-2 px-3.5 py-2.5',
                !c.active && 'opacity-60',
              )}
            >
              {isEditing ? (
                <form
                  className="flex min-w-[200px] flex-1 items-center gap-2"
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
                  />
                  <Button type="submit" size="sm" disabled={pending}>
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </form>
              ) : (
                <span className="min-w-[200px] flex-1 text-[14px] font-medium text-zinc-800">
                  {c.name}
                  {!c.active && (
                    <Badge tone="neutral" className="ml-2">
                      Archivada
                    </Badge>
                  )}
                </span>
              )}
              {kind === 'EXPENSE' && (
                <span className="flex items-center gap-2 text-[12px] font-semibold text-zinc-600">
                  <Switch
                    checked={c.isFixed}
                    disabled={pending || !c.active}
                    onCheckedChange={(v) => run(() => updateCategoryAction(c.id, { isFixed: v }))}
                    label={`${c.name}: coste fijo`}
                  />
                  Fijo
                </span>
              )}
              {!isEditing && c.active && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditing({ id: c.id, name: c.name })}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                title={c.active ? 'Archivar' : 'Recuperar'}
                onClick={() => run(() => updateCategoryAction(c.id, { active: !c.active }))}
              >
                {c.active ? (
                  <Archive className="h-3.5 w-3.5" />
                ) : (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                )}
              </Button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="px-3.5 py-6 text-center text-[13px] text-zinc-500">Sin categorías.</li>
        )}
      </ul>
      {archivedCount > 0 && (
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="self-start text-[12px] font-semibold text-zinc-500 hover:text-zinc-800"
        >
          {showArchived
            ? 'Ocultar archivadas'
            : `Ver ${archivedCount} archivada${archivedCount === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}
