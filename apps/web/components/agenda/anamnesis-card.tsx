'use client';

import { saveAnamnesisAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  type AnamnesisAnswers,
  type AnamnesisItem,
  anamnesisConflicts,
  groupAnamnesis,
} from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * La anamnesis del paciente, en su pestaña.
 *
 * Los ítems van por bloques (Antecedentes médicos · Perinatal · Entorno, lo
 * que diga la plantilla) y, dentro de cada bloque, lo pendiente primero. Cada
 * ítem es sí / no / sin contestar —tres estados, y el tercero se ve— y, con
 * "sí", un "¿cuál?" con texto guía. Las siglas llevan su nombre completo. Una
 * contradicción evidente ("Sano: sí" y "Enfermedad importante: sí") se avisa,
 * no se bloquea. Abajo queda quién la guardó por última vez y cuándo.
 */
export function AnamnesisCard({
  patientId,
  template,
  answers,
  canEdit,
  updatedAtLabel,
  updatedBy,
}: {
  patientId: string;
  template: AnamnesisItem[];
  answers: AnamnesisAnswers;
  canEdit: boolean;
  updatedAtLabel: string | null;
  updatedBy: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [draft, setDraft] = React.useState<AnamnesisAnswers>(answers);
  const [dirty, setDirty] = React.useState(false);

  // El orden se decide con lo guardado, no con el borrador: una fila que
  // salta al contestarla es lo peor que le puede pasar a quien está tecleando.
  const groups = React.useMemo(() => {
    const isPending = (item: AnamnesisItem) => (answers[item.key]?.value ?? null) === null;
    return groupAnamnesis(template).map((g) => ({
      ...g,
      items: [...g.items.filter(isPending), ...g.items.filter((i) => !isPending(i))],
    }));
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
  const pendingCount = template.length - answered;
  const conflicts = anamnesisConflicts(template, draft);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] flex-1">
          <h2 className="text-[18px] font-bold tracking-tight text-zinc-900">Anamnesis</h2>
          <p className="mt-0.5 text-[13px] text-zinc-600">
            {pendingCount > 0
              ? `${answered} de ${template.length} contestados · lo pendiente, primero`
              : `Completa · ${template.length} de ${template.length}`}
          </p>
        </div>
        <p className="text-[12px] text-zinc-600">
          {updatedAtLabel
            ? `Guardada por ${updatedBy ?? 'el equipo'} · ${updatedAtLabel}`
            : 'Todavía nadie la ha guardado'}
        </p>
      </div>

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Revisa estas respuestas</p>
            <ul className="mt-0.5 list-disc pl-4">
              {conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.group ?? 'sin-bloque'} className="flex flex-col gap-1.5">
          {g.group && (
            <h3 className="mt-1 text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-600">
              {g.group}
            </h3>
          )}
          <ul className="flex flex-col gap-1.5">
            {g.items.map((item) => {
              const a = draft[item.key] ?? { value: null, detail: '' };
              const isNull = a.value === null;
              const askDetail = a.value === true && !item.noDetail;
              return (
                <li
                  key={item.key}
                  className={cn(
                    'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 rounded-[14px] border px-3 py-2 md:grid-cols-[210px_auto_minmax(0,1fr)]',
                    isNull
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-(--color-border-subtle) bg-[#fbfcfc]',
                  )}
                >
                  <span className="min-w-0">
                    <span
                      className="block text-[14px] font-semibold text-zinc-800"
                      title={item.fullName ?? undefined}
                    >
                      {item.label}
                    </span>
                    {item.fullName && (
                      <span className="block truncate text-[12px] text-zinc-600">
                        {item.fullName}
                      </span>
                    )}
                  </span>
                  <fieldset className="m-0 flex shrink-0 items-center gap-1.5 border-0 p-0">
                    <legend className="sr-only">{item.fullName ?? item.label}</legend>
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
                    {isNull && (
                      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                        Sin contestar
                      </span>
                    )}
                  </fieldset>
                  {askDetail ? (
                    <input
                      aria-label={`${item.label}: cuál`}
                      value={a.detail}
                      disabled={!canEdit}
                      onChange={(e) => set(item.key, { detail: e.target.value })}
                      placeholder={item.hint ?? '¿Cuál?'}
                      className="col-span-2 h-10 w-full rounded-xl border border-(--color-border) bg-white px-3.5 text-[16px] text-zinc-900 outline-none placeholder:text-zinc-500 focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/12 disabled:bg-zinc-50 md:col-span-1"
                    />
                  ) : (
                    <span className="hidden md:block" />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {canEdit && (
        <div className="sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-(--color-border) bg-white/[.94] px-4 py-3 pr-24 backdrop-blur-xl md:-mx-6 md:-mb-6 md:px-6 md:pr-24">
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700">
              <Check className="h-4 w-4" /> Guardada
            </span>
          )}
          {dirty && !saved && (
            <span className="text-[12px] text-zinc-600">Cambios sin guardar</span>
          )}
          <Button
            onClick={submit}
            disabled={pending || !dirty}
            className="h-12 flex-1 md:h-11 md:flex-none"
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
          : 'bg-white text-zinc-700 ring-(--color-border) enabled:hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
