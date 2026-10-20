'use client';

import { Button } from '@/components/ui/button';
import { CalendarClock } from 'lucide-react';

const WEEKDAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export type AvailabilityReason =
  | 'OK'
  | 'NO_PROFESSIONAL'
  | 'AGENDA_DISABLED'
  | 'NO_SHIFTS'
  | 'DAY_OFF';

function listWeekdays(days: number[]): string {
  const names = days.map((d) => WEEKDAY_SHORT[d - 1]).filter(Boolean) as string[];
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * Por qué no hay huecos ese día y la salida: darla igualmente a mano. Sin
 * esto, un día sin horario (un sábado) o completo dejaba a recepción delante
 * de "no quedan huecos" sin saber si era un fallo o cómo seguir.
 */
export function NoSlotsNotice({
  loading,
  reason,
  workingWeekdays,
  forceLabel,
  onForce,
}: {
  loading: boolean;
  reason: AvailabilityReason;
  workingWeekdays: number[];
  forceLabel: string;
  onForce: () => void;
}) {
  if (loading) return <p className="text-[12px] text-zinc-500">Buscando…</p>;
  const text =
    reason === 'DAY_OFF'
      ? `Ese día no está en su horario${
          workingWeekdays.length ? ` (trabaja ${listWeekdays(workingWeekdays)})` : ''
        }.`
      : reason === 'NO_SHIFTS'
        ? 'Este profesional no tiene horario cargado.'
        : reason === 'AGENDA_DISABLED'
          ? 'La agenda de este profesional está apagada.'
          : 'No quedan huecos libres ese día.';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[12px] text-zinc-600">{text}</p>
      {reason !== 'AGENDA_DISABLED' && reason !== 'NO_PROFESSIONAL' && (
        <Button type="button" size="sm" variant="soft" onClick={onForce}>
          <CalendarClock className="h-3.5 w-3.5" /> {forceLabel}
        </Button>
      )}
    </div>
  );
}
