'use client';

import {
  cancelPriorityRequestAction,
  createPriorityRequestAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Loader2, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface ActivePriorityRequest {
  id: string;
  fromDay: string;
  untilDay: string;
  professionalName: string | null;
  note: string | null;
}

function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'hoy';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * "Si se libera un hueco, que sea para este paciente". Va el primero de la
 * cola: antes que quien quiere adelantar y antes que la lista de espera. Si la
 * familia acepta, se le da la cita y le llega la confirmación de siempre.
 */
export function PrioritySlotButton({
  patientId,
  patientName,
  todayKey,
  professionals,
  active,
}: {
  patientId: string;
  patientName: string;
  todayKey: string;
  professionals: { id: string; fullName: string }[];
  active: ActivePriorityRequest | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [fromDay, setFromDay] = React.useState(todayKey);
  const [untilDay, setUntilDay] = React.useState(todayKey);
  const [professionalId, setProfessionalId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const router = useRouter();

  function save() {
    start(async () => {
      setError(null);
      const r = await createPriorityRequestAction({
        patientId,
        fromDay,
        untilDay: untilDay < fromDay ? fromDay : untilDay,
        professionalId: professionalId || null,
        note,
      });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error);
    });
  }

  function cancel() {
    if (!active) return;
    start(async () => {
      setError(null);
      const r = await cancelPriorityRequestAction(active.id, patientId);
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={active ? 'success' : 'secondary'}
        onClick={() => setOpen(true)}
        title="Que sea el primero en recibir un hueco que se libere"
      >
        <Zap className="h-4 w-4" />
        <span className="hidden sm:inline">
          {active
            ? `Primer hueco: ${active.fromDay === active.untilDay ? dayLabel(active.fromDay, todayKey) : `${dayLabel(active.fromDay, todayKey)}–${dayLabel(active.untilDay, todayKey)}`}`
            : 'Primer hueco libre'}
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Primer hueco que se libere para {patientName}</DialogTitle>
            <DialogDescription>
              Si se libera un hueco en esos días, se le ofrece a esta familia antes que a nadie. Si
              acepta, se le da la cita y le llega la confirmación de siempre.
            </DialogDescription>
          </DialogHeader>

          {active && (
            <div className="flex items-start justify-between gap-3 rounded-[14px] bg-emerald-50 p-3 text-[13px] text-emerald-900">
              <span>
                <strong>Activa</strong>:{' '}
                {active.fromDay === active.untilDay
                  ? dayLabel(active.fromDay, todayKey)
                  : `del ${dayLabel(active.fromDay, todayKey)} al ${dayLabel(active.untilDay, todayKey)}`}
                {active.professionalName
                  ? ` · con ${active.professionalName}`
                  : ' · cualquier profesional'}
                {active.note ? ` · ${active.note}` : ''}
              </span>
              <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>
                Quitar
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prio-from">Desde</Label>
              <Input
                id="prio-from"
                type="date"
                value={fromDay}
                min={todayKey}
                onChange={(e) => setFromDay(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prio-until">Hasta</Label>
              <Input
                id="prio-until"
                type="date"
                value={untilDay}
                min={fromDay}
                onChange={(e) => setUntilDay(e.target.value)}
              />
            </div>
          </div>
          {professionals.length > 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="prio-prof">Con quién</Label>
              <Select
                id="prio-prof"
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
              >
                <option value="">Cualquier profesional</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="prio-note">Motivo (lo ve el equipo)</Label>
            <Textarea
              id="prio-note"
              value={note}
              maxLength={300}
              placeholder="Ej.: viene de un ingreso"
              className="min-h-[72px]"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && <p className="text-[13px] text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cerrar
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {active ? 'Sustituir' : 'Guardar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
