'use client';

import { saveFinanceSettingsAction } from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Input, Label } from '@/components/ui/input';
import { centsToInput } from '@/lib/agenda/billing';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/**
 * El objetivo de ingresos mensual: la barra del Resumen mide contra esto. Se
 * guarda solo al salir del campo o con Intro, como el resto de Ajustes.
 */
export function SettingsForm({
  monthlyRevenueGoalCents,
}: { monthlyRevenueGoalCents: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [goal, setGoal] = React.useState(centsToInput(monthlyRevenueGoalCents));
  const [lastSaved, setLastSaved] = React.useState(centsToInput(monthlyRevenueGoalCents));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  function save() {
    if (goal.trim() === lastSaved.trim()) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await saveFinanceSettingsAction({ monthlyRevenueGoal: goal });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setLastSaved(goal);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-3 p-4 sm:p-6 sm:pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fin-goal">Objetivo de ingresos al mes (€)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="fin-goal"
            inputMode="decimal"
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              setSaved(false);
            }}
            onBlur={save}
            placeholder="Ej.: 6.000"
            className="max-w-xs placeholder:text-zinc-400/80"
          />
          <span
            className="inline-flex min-w-[90px] items-center gap-1 text-[12px]"
            aria-live="polite"
          >
            {pending ? (
              <span className="inline-flex items-center gap-1 text-zinc-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando…
              </span>
            ) : saved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                <Check className="h-3.5 w-3.5" /> Guardado
              </span>
            ) : null}
          </span>
        </div>
        <p className="text-[12px] text-zinc-600">
          Se guarda al salir del campo. Déjalo vacío para no medir contra ningún objetivo. Para
          períodos de más de un mes se multiplica por los meses. También se cambia desde el Resumen.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}
    </form>
  );
}
