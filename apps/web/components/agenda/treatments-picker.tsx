'use client';

import { setProfessionalTreatmentsAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface TreatmentOption {
  id: string;
  name: string;
  durationMinutes: number;
  active: boolean | null;
}

export interface AssignedTreatment {
  treatmentId: string;
  durationOverrideMinutes: number | null;
}

/**
 * Qué tratamientos realiza el profesional, del catálogo que ya cargó la clínica
 * en el onboarding. La duración se puede pisar por profesional: el mismo
 * implante no dura lo mismo con el cirujano veterano que con el resto.
 */
export function TreatmentsPicker({
  professionalId,
  catalog,
  assigned,
}: {
  professionalId: string;
  catalog: TreatmentOption[];
  assigned: AssignedTreatment[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Map<string, number | null>>(
    new Map(assigned.map((a) => [a.treatmentId, a.durationOverrideMinutes])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, null);
      return next;
    });
    setSaved(false);
  }

  function setOverride(id: string, value: string) {
    const n = Number(value);
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(id, Number.isFinite(n) && n > 0 ? n : null);
      return next;
    });
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await setProfessionalTreatmentsAction(
        professionalId,
        [...selected.entries()].map(([treatmentId, durationOverrideMinutes]) => ({
          treatmentId,
          durationOverrideMinutes,
        })),
      );
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (catalog.length === 0) {
    return (
      <p className="text-[13px] text-zinc-500">
        El catálogo de tratamientos está vacío. Cárgalo en Tratamientos y vuelve aquí para asignar
        los que realiza este profesional.
      </p>
    );
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.map((t) => {
          const isOn = selected.has(t.id);
          return (
            <div
              key={t.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-[14px] border p-3 transition-colors',
                isOn ? 'border-brand-200 bg-brand-50/50' : 'border-[--color-border] bg-white',
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(t.id)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-zinc-800">
                    {t.name}
                  </span>
                  <span className="block text-[12px] text-zinc-500">
                    {t.durationMinutes} min por defecto
                    {t.active === false ? ' · inactivo en el catálogo' : ''}
                  </span>
                </span>
              </label>
              {isOn && (
                <Input
                  type="number"
                  min={5}
                  step={5}
                  aria-label={`Duración propia para ${t.name}`}
                  placeholder={String(t.durationMinutes)}
                  className="h-9 w-[92px] px-2 text-[13px]"
                  value={selected.get(t.id) ?? ''}
                  onChange={(e) => setOverride(t.id, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-600">
            <Check className="h-4 w-4" /> Guardado
          </span>
        )}
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar tratamientos
        </Button>
      </div>
    </div>
  );
}
