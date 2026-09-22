'use client';

import { saveAnamnesisAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTopbar } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { AnamnesisAnswers, AnamnesisItem } from '@/lib/care-profile/policy';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, ClipboardList, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * La anamnesis del paciente, siempre arriba de la ficha.
 *
 * Una fila por ítem de la plantilla de la clínica: sí / no y, cuando es sí, el
 * "cuál". Lo no contestado se ve como tal, sin inventar un "no": en pediatría
 * "no consta" y "no" no son lo mismo.
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

  const answered = template.filter(
    (i) => draft[i.key]?.value !== null && draft[i.key] !== undefined,
  ).length;

  return (
    <Card>
      <CardTopbar
        icon={<ClipboardList className="h-4 w-4" />}
        title="Anamnesis"
        subtitle={`${answered} de ${template.length} contestados`}
        tone="honey"
      />
      <CardContent>
        <ul className="divide-y divide-[--color-border]">
          {template.map((item) => {
            const a = draft[item.key] ?? { value: null, detail: '' };
            return (
              <li
                key={item.key}
                className="grid items-center gap-2 py-2 sm:grid-cols-[minmax(150px,1fr)_auto_minmax(160px,1.4fr)]"
              >
                <span className="text-[14px] font-semibold text-zinc-800">{item.label}</span>
                <fieldset className="m-0 flex gap-1 border-0 p-0">
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
                  <Input
                    aria-label={`${item.label}: cuál`}
                    value={a.detail}
                    disabled={!canEdit}
                    onChange={(e) => set(item.key, { detail: e.target.value })}
                    placeholder={item.hint ?? '¿Cuál?'}
                    className="h-9"
                  />
                ) : (
                  <span className="text-[12px] text-zinc-400">
                    {a.value === null ? 'Sin contestar' : ''}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {canEdit && (
          <div className="mt-3 flex items-center justify-end gap-2">
            {saved && !dirty && (
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
                <Check className="h-4 w-4" /> Guardada
              </span>
            )}
            <Button size="sm" onClick={submit} disabled={pending || !dirty}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Guardar anamnesis
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
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
        'rounded-full px-3 py-1 text-[12px] font-semibold ring-1 transition-colors disabled:cursor-default',
        active
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-zinc-600 ring-[--color-border] enabled:hover:bg-brand-50',
      )}
    >
      {children}
    </button>
  );
}
