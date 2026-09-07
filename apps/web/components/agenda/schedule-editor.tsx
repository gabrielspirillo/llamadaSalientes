'use client';

import { saveScheduleAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button, IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WEEKDAYS, WEEKDAY_LABELS, hhmmToMinutes, minutesToHHMM } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import { AlertTriangle, Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ShiftRowValue {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Editor del horario semanal.
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

  function addRow(weekday: number) {
    const ofDay = rows.filter((r) => r.weekday === weekday);
    const last = ofDay[ofDay.length - 1];
    const start = last ? Math.min(last.endMinute + 60, 1380) : 9 * 60;
    setRows((r) => [...r, { weekday, startMinute: start, endMinute: Math.min(start + 240, 1440) }]);
    setSaved(false);
  }

  function removeRow(index: number) {
    setRows((r) => r.filter((_, i) => i !== index));
    setSaved(false);
  }

  function patchRow(index: number, patch: Partial<ShiftRowValue>) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(false);
  }

  /** Copia el horario del primer día que tenga franjas al resto de laborables. */
  function copyToWeekdays() {
    const source = rows.filter((r) => r.weekday === firstDayWithRows);
    if (source.length === 0) return;
    const rest = rows.filter((r) => r.weekday > 5 || r.weekday === firstDayWithRows);
    const copies = [1, 2, 3, 4, 5]
      .filter((d) => d !== firstDayWithRows)
      .flatMap((d) => source.map((s) => ({ ...s, weekday: d })));
    setRows([...rest, ...copies]);
    setSaved(false);
  }

  const firstDayWithRows = React.useMemo(() => {
    for (const d of WEEKDAYS) if (rows.some((r) => r.weekday === d)) return d;
    return 1;
  }, [rows]);

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
      <div className="space-y-3">
        {WEEKDAYS.map((day) => {
          const indexes = rows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.weekday === day)
            .sort((a, b) => a.r.startMinute - b.r.startMinute);
          return (
            <div
              key={day}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-[14px] border p-3',
                indexes.length > 0
                  ? 'border-[--color-border] bg-white'
                  : 'border-dashed border-[--color-border] bg-zinc-50/60',
              )}
            >
              <span className="w-24 shrink-0 text-[14px] font-bold text-zinc-800">
                {WEEKDAY_LABELS[day]}
              </span>

              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {indexes.length === 0 && (
                  <span className="text-[13px] text-zinc-400">No trabaja</span>
                )}
                {indexes.map(({ r, i }) => (
                  <div key={`${day}-${i}`} className="flex items-center gap-1.5">
                    <Input
                      type="time"
                      aria-label={`Inicio ${WEEKDAY_LABELS[day]}`}
                      className="h-9 w-[112px] px-2 text-[13px]"
                      value={minutesToHHMM(r.startMinute)}
                      onChange={(e) =>
                        patchRow(i, { startMinute: hhmmToMinutes(e.target.value) ?? r.startMinute })
                      }
                    />
                    <span className="text-zinc-400">–</span>
                    <Input
                      type="time"
                      aria-label={`Fin ${WEEKDAY_LABELS[day]}`}
                      className="h-9 w-[112px] px-2 text-[13px]"
                      value={minutesToHHMM(r.endMinute)}
                      onChange={(e) =>
                        patchRow(i, { endMinute: hhmmToMinutes(e.target.value) ?? r.endMinute })
                      }
                    />
                    <IconButton label="Quitar franja" onClick={() => removeRow(i)}>
                      <Trash2 className="h-4 w-4 text-zinc-400" />
                    </IconButton>
                  </div>
                ))}
              </div>

              <Button variant="ghost" size="sm" onClick={() => addRow(day)}>
                <Plus className="h-4 w-4" /> Franja
              </Button>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={copyToWeekdays}>
          <Copy className="h-4 w-4" /> Copiar {WEEKDAY_LABELS[firstDayWithRows]} al resto de la
          semana
        </Button>
        <div className="flex items-center gap-2">
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
    </div>
  );
}
