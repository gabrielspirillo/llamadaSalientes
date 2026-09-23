'use client';

import { saveFinanceSettingsAction } from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { centsToInput } from '@/lib/agenda/billing';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** El objetivo de ingresos mensual: la barra del Resumen mide contra esto. */
export function SettingsForm({
  monthlyRevenueGoalCents,
}: { monthlyRevenueGoalCents: number | null }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [goal, setGoal] = React.useState(centsToInput(monthlyRevenueGoalCents));
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  return (
    <form
      className="flex flex-col gap-3 p-4 sm:p-6 sm:pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const r = await saveFinanceSettingsAction({ monthlyRevenueGoal: goal });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fin-goal">Objetivo de ingresos al mes (€)</Label>
        <Input
          id="fin-goal"
          inputMode="decimal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="6.000"
          className="max-w-xs"
        />
        <p className="text-[12px] text-zinc-500">
          Déjalo vacío para no medir contra ningún objetivo. Para períodos de más de un mes se
          multiplica por los meses.
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
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Guardar
        </Button>
        {saved && <span className="text-[13px] text-emerald-700">Guardado.</span>}
      </div>
    </form>
  );
}
