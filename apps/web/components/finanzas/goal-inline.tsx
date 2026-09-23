'use client';

import { saveFinanceSettingsAction } from '@/app/(dashboard)/dashboard/finanzas/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { centsToInput } from '@/lib/agenda/billing';
import { AlertTriangle, Check, Loader2, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

/** Fijar o cambiar el objetivo mensual sin salir del Resumen. */
export function GoalInline({
  monthlyRevenueGoalCents,
}: { monthlyRevenueGoalCents: number | null }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(centsToInput(monthlyRevenueGoalCents));
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await saveFinanceSettingsAction({ monthlyRevenueGoal: value });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        <Pencil className="h-3.5 w-3.5" />{' '}
        {monthlyRevenueGoalCents ? 'Cambiar objetivo' : 'Fijar objetivo'}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ej.: 6.000"
          aria-label="Objetivo de ingresos al mes en euros"
          className="h-10 w-[140px]"
          autoFocus
        />
        <span className="text-[13px] text-zinc-600">€ al mes</span>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancelar
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-1 text-[12px] text-rose-700">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
    </form>
  );
}
