'use client';

import { addTimeOffAction, removeTimeOffAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { BLOCK_KIND_LABELS, type BlockKind } from '@/lib/agenda/shared';
import { AlertTriangle, CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface TimeOffRowValue {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  kind: BlockKind;
  reason: string | null;
  /** Ya formateado en servidor con la timezone de la clínica. */
  label: string;
}

/**
 * Bloqueos: vacaciones, festivos, una tarde de formación.
 *
 * Las citas que caigan dentro NO se borran solas — se avisa de cuántas hay para
 * que la clínica decida a quién llama. Borrarlas en silencio sería peor que el
 * problema que resuelve el bloqueo.
 */
export function TimeOffEditor({
  professionalId,
  blocks,
  timezone,
}: {
  professionalId: string;
  blocks: TimeOffRowValue[];
  timezone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = React.useState(today);
  const [toDate, setToDate] = React.useState(today);
  const [allDay, setAllDay] = React.useState(true);
  const [fromTime, setFromTime] = React.useState('09:00');
  const [toTime, setToTime] = React.useState('14:00');
  const [kind, setKind] = React.useState<BlockKind>('TIME_OFF');
  const [reason, setReason] = React.useState('');

  function submit() {
    setError(null);
    setWarning(null);
    // Se manda el día y el minuto locales; la conversión a instante la hace el
    // servidor con la timezone de la clínica. Si la hiciera el navegador, un
    // "no vengo el martes" empezaría a la hora de donde esté quien lo carga.
    const toMinute = (v: string) => {
      const [h, m] = v.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };

    startTransition(async () => {
      const result = await addTimeOffAction(professionalId, {
        startDateKey: fromDate,
        startMinute: allDay ? 0 : toMinute(fromTime),
        endDateKey: toDate,
        endMinute: allDay ? 1440 : toMinute(toTime),
        allDay,
        kind,
        reason,
      });
      if (result.ok) {
        setShowForm(false);
        setReason('');
        if (result.data && result.data.conflictingAppointments > 0) {
          setWarning(
            `Hay ${result.data.conflictingAppointments} cita(s) dentro de ese bloqueo. Revísalas y avisa a los pacientes: no se han cancelado solas.`,
          );
        }
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      {blocks.length === 0 ? (
        <p className="text-[13px] text-zinc-500">
          Sin bloqueos. Añade aquí vacaciones, festivos o cualquier rato en el que este profesional
          no pase consulta.
        </p>
      ) : (
        <ul className="divide-y divide-[--color-border-subtle]">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <CalendarOff className="h-4 w-4 shrink-0 text-zinc-400" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-zinc-800">{b.label}</p>
                  <p className="truncate text-[12px] text-zinc-500">
                    {b.reason ?? BLOCK_KIND_LABELS[b.kind]}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{BLOCK_KIND_LABELS[b.kind]}</Badge>
                <IconButton
                  label="Quitar bloqueo"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeTimeOffAction(b.id);
                      if (result.ok) router.refresh();
                      else setError(result.error);
                    })
                  }
                >
                  <Trash2 className="h-4 w-4 text-zinc-400" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {warning && (
        <p className="mt-3 rounded-[14px] bg-amber-50 p-3 text-[13px] text-amber-800">{warning}</p>
      )}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {showForm ? (
        <div className="mt-4 rounded-[14px] border border-[--color-border] p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="to-from">Desde</Label>
              <Input
                id="to-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to-to">Hasta</Label>
              <Input
                id="to-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="to-fromt">Hora inicio</Label>
                  <Input
                    id="to-fromt"
                    type="time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="to-tot">Hora fin</Label>
                  <Input
                    id="to-tot"
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="to-kind">Tipo</Label>
              <Select
                id="to-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as BlockKind)}
              >
                {Object.entries(BLOCK_KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to-reason">Motivo (opcional)</Label>
              <Input
                id="to-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Vacaciones, congreso…"
              />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[13px] text-zinc-600">
            <input
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4"
            />
            Día(s) completo(s)
          </label>

          <p className="mt-2 text-[12px] text-zinc-500">Las horas se interpretan en {timezone}.</p>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Bloquear
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Añadir bloqueo
        </Button>
      )}
    </div>
  );
}
