'use client';

import { saveAnamnesisAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import type { AnamnesisAnswers, AnamnesisItem } from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * La anamnesis del paciente, en su pestaña.
 *
 * Una fila por ítem de la plantilla de la clínica: sí / no y, cuando es sí, el
 * "cuál". Lo no contestado se ve como tal, sin inventar un "no": en pediatría
 * "no consta" y "no" no son lo mismo. Lo pendiente va primero y en ámbar,
 * para que en la primera visita se rellene de arriba abajo; el orden se fija
 * al abrir la pestaña y no salta mientras se contesta.
 */
export function AnamnesisCard({
  patientId,
  template,
  answers,
  canEdit,
}: {
  patientId: string;
  template: AnamnesisItem[];
  answers: AnamnesisAnswers;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [draft, setDraft] = React.useState<AnamnesisAnswers>(answers);
  const [dirty, setDirty] = React.useState(false);

  // El orden se decide con lo guardado, no con el borrador: una fila que
  // salta al contestarla es lo peor que le puede pasar a quien está tecleando.
  const ordered = React.useMemo(() => {
    const isPending = (item: AnamnesisItem) => (answers[item.key]?.value ?? null) === null;
    return [...template.filter(isPending), ...template.filter((i) => !isPending(i))];
  }, [template, answers]);

  function set(key: string, patch: Partial<{ value: boolean | null; detail: string }>) {
    setDirty(true);
    setSaved(false);
    setDraft((prev) => {
      const current = prev[key] ?? { value: null, detail: '' };
      return { ...prev, [key]: { ...current, ...patch } };
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await saveAnamnesisAction(patientId, draft);
      if (result.ok) {
        setSaved(true);
        setDirty(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const answered = template.filter((i) => (draft[i.key]?.value ?? null) !== null).length;
  const pct = template.length ? Math.round((answered / template.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[160px] flex-1">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">Anamnesis</h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {answered} de {template.length} contestados · lo pendiente, primero
          </p>
        </div>
        {/* Decorativa: el texto de arriba ya dice cuántos van. */}
        <div className="h-1.5 w-[140px] overflow-hidden rounded-full bg-zinc-100" aria-hidden>
          <div
            className="h-full rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {ordered.map((item) => {
          const a = draft[item.key] ?? { value: null, detail: '' };
          const isNull = a.value === null;
          return (
            <li
              key={item.key}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-[14px] border px-3 py-2 md:grid-cols-[190px_auto_minmax(0,1fr)]',
                isNull
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-[--color-border-subtle] bg-[#fbfcfc]',
              )}
            >
              <span className="min-w-0 text-[14px] font-semibold text-zinc-800">{item.label}</span>
              <fieldset className="m-0 flex shrink-0 gap-1.5 border-0 p-0">
                <legend className="sr-only">{item.label}</legend>
                <Toggle
                  active={a.value === true}
                  disabled={!canEdit}
                  onClick={() => set(item.key, { value: a.value === true ? null : true })}
                >
                  Sí
                </Toggle>
                <Toggle
                  active={a.value === false}
                  disabled={!canEdit}
                  onClick={() =>
                    set(item.key, { value: a.value === false ? null : false, detail: '' })
                  }
                >
                  No
                </Toggle>
              </fieldset>
              {a.value === true ? (
                <input
                  aria-label={`${item.label}: cuál`}
                  value={a.detail}
                  disabled={!canEdit}
                  onChange={(e) => set(item.key, { detail: e.target.value })}
                  placeholder={item.hint ?? '¿Cuál?'}
                  className="col-span-2 h-10 w-full rounded-xl border border-[--color-border] bg-white px-3.5 text-[16px] text-zinc-900 outline-none placeholder:text-zinc-400 focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/12 disabled:bg-zinc-50 md:col-span-1"
                />
              ) : (
                <span className="hidden text-[12px] text-amber-700 md:block">
                  {isNull ? 'Sin contestar' : ''}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {canEdit && (
        <div
          className={cn(
            'sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-[--color-border] bg-white/[.92] px-4 py-3 backdrop-blur-xl',
            'md:static md:m-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
          )}
        >
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
              <Check className="h-4 w-4" /> Guardada
            </span>
          )}
          <Button
            onClick={submit}
            disabled={pending || !dirty}
            className="h-12 w-full md:h-11 md:w-auto"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Guardar anamnesis
          </Button>
        </div>
      )}
    </div>
  );
}

function Toggle({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-h-11 min-w-14 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold ring-1 transition-colors disabled:cursor-default md:min-h-[30px] md:min-w-0',
        active
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-zinc-600 ring-[--color-border] enabled:hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
