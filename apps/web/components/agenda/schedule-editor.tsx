'use client';

import { saveScheduleAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { ScheduleFields, type ShiftRowValue } from '@/components/agenda/schedule-fields';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export type { ShiftRowValue };

/**
 * Editor del horario semanal de la ficha del profesional.
 *
 * Varias franjas por día: la comida es el hueco entre dos franjas, no una
 * excepción. Se guarda el horario COMPLETO de una vez — un guardado parcial por
 * franja dejaría horarios a medias si una petición se pierde.
 */
export function ScheduleEditor({
  professionalId,
  initial,
}: {
  professionalId: string;
  initial: ShiftRowValue[];
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<ShiftRowValue[]>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function handleChange(next: ShiftRowValue[]) {
    setRows(next);
    setSaved(false);
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveScheduleAction(
        professionalId,
        rows.map((r) => ({
          weekday: r.weekday,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
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

  return (
    <div>
      <ScheduleFields rows={rows} onChange={handleChange} />

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
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar horario
        </Button>
      </div>
    </div>
  );
}
