'use client';

import { Button, IconButton } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WEEKDAYS, WEEKDAY_LABELS, hhmmToMinutes, minutesToHHMM } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import { Copy, Plus, Trash2 } from 'lucide-react';
import * as React from 'react';

export interface ShiftRowValue {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/**
 * Rejilla del horario semanal, sin guardado propio.
 *
 * Vive aparte del editor de la ficha porque el asistente de alta la usa igual
 * pero guarda al final, junto con el resto del profesional: duplicar el bloque
 * habría dejado dos horarios que se comportan distinto.
 */
export function ScheduleFields({
  rows,
  onChange,
}: {
  rows: ShiftRowValue[];
  onChange: (rows: ShiftRowValue[]) => void;
}) {
  const primerDiaConFranjas = React.useMemo(() => {
    for (const d of WEEKDAYS) if (rows.some((r) => r.weekday === d)) return d;
    return 1;
  }, [rows]);

  function addRow(weekday: number) {
    const ofDay = rows.filter((r) => r.weekday === weekday);
    const last = ofDay[ofDay.length - 1];
    const start = last ? Math.min(last.endMinute + 60, 1380) : 9 * 60;
    onChange([...rows, { weekday, startMinute: start, endMinute: Math.min(start + 240, 1440) }]);
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function patchRow(index: number, patch: Partial<ShiftRowValue>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** Copia el horario del primer día que tenga franjas al resto de laborables. */
  function copyToWeekdays() {
    const source = rows.filter((r) => r.weekday === primerDiaConFranjas);
    if (source.length === 0) return;
    const rest = rows.filter((r) => r.weekday > 5 || r.weekday === primerDiaConFranjas);
    const copies = [1, 2, 3, 4, 5]
      .filter((d) => d !== primerDiaConFranjas)
      .flatMap((d) => source.map((s) => ({ ...s, weekday: d })));
    onChange([...rest, ...copies]);
  }

  return (
    <div>
      <div className="space-y-2">
        {WEEKDAYS.map((day) => {
          const indexes = rows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.weekday === day)
            .sort((a, b) => a.r.startMinute - b.r.startMinute);
          return (
            <div
              key={day}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-[14px] border p-2.5',
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

      <Button variant="ghost" size="sm" className="mt-3" onClick={copyToWeekdays}>
        <Copy className="h-4 w-4" /> Copiar {WEEKDAY_LABELS[primerDiaConFranjas]} al resto de la
        semana
      </Button>
    </div>
  );
}

/** Horario de partida del asistente: de lunes a viernes, de 9 a 14 y de 16 a 20. */
export function horarioPorDefecto(): ShiftRowValue[] {
  return [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: 9 * 60, endMinute: 14 * 60 },
    { weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
  ]);
}
