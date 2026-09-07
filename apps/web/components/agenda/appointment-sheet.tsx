'use client';

import {
  cancelAppointmentAction,
  rescheduleAppointmentAction,
  updateAppointmentAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { type AppointmentStatus, SOURCE_LABELS, STATUS_LABELS } from '@/lib/agenda/shared';
import type { CalendarItem } from '@/lib/agenda/view';
import { cn } from '@/lib/cn';
import { AlertTriangle, CalendarClock, Loader2, NotebookPen, Phone, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

const FLOW: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Ficha de la cita: estado, reagendar, cancelar y salto a la historia clínica. */
export function AppointmentSheet({
  item,
  canWrite,
  treatments,
  onClose,
}: {
  item: CalendarItem;
  canWrite: boolean;
  treatments: { id: string; name: string; durationMinutes: number }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [showReschedule, setShowReschedule] = React.useState(false);
  const [dateKey, setDateKey] = React.useState(item.dateKey);
  const [time, setTime] = React.useState(hhmm(item.startMinute));
  const [duration, setDuration] = React.useState(item.durationMinutes);
  const [treatmentId, setTreatmentId] = React.useState(item.treatmentId ?? '');

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.patientName}
          </DialogTitle>
          <DialogDescription>
            {hhmm(item.startMinute)}–{hhmm(item.endMinute)} · {item.professionalName}
            {item.treatmentName ? ` · ${item.treatmentName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={item.status === 'CANCELLED' ? 'danger' : 'info'}>
              {STATUS_LABELS[item.status]}
            </Badge>
            <Badge tone="neutral">{SOURCE_LABELS[item.source]}</Badge>
            {item.patientPhone && (
              <a
                href={`tel:${item.patientPhone}`}
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 hover:underline"
              >
                <Phone className="h-3.5 w-3.5" /> {item.patientPhone}
              </a>
            )}
          </div>

          {item.notes && (
            <p className="rounded-[14px] bg-zinc-50 p-3 text-[13px] leading-relaxed text-zinc-700">
              {item.notes}
            </p>
          )}

          {canWrite && (
            <div>
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                Estado
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FLOW.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => updateAppointmentAction(item.id, { status: s }))}
                    className={cn(
                      'rounded-full px-3 py-1 text-[12px] font-semibold transition-colors',
                      item.status === s
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-zinc-600 ring-1 ring-[--color-border] hover:bg-brand-50',
                    )}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => updateAppointmentAction(item.id, { status: 'NO_SHOW' }))}
                  className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50"
                >
                  No se presentó
                </button>
              </div>
            </div>
          )}

          {canWrite && showReschedule && (
            <div className="rounded-[14px] border border-[--color-border] p-3">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                Mover la cita
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="rs-date">Día</Label>
                  <Input
                    id="rs-date"
                    type="date"
                    value={dateKey}
                    onChange={(e) => setDateKey(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rs-time">Hora</Label>
                  <Input
                    id="rs-time"
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rs-dur">Duración</Label>
                  <Input
                    id="rs-dur"
                    type="number"
                    min={5}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReschedule(false)}>
                  Cerrar
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const [h, m] = time.split(':').map(Number);
                    run(() =>
                      rescheduleAppointmentAction(item.id, {
                        startDateKey: dateKey,
                        startMinute: (h ?? 9) * 60 + (m ?? 0),
                        durationMinutes: duration,
                      }),
                    );
                  }}
                >
                  Guardar cambio
                </Button>
              </div>
            </div>
          )}

          {canWrite && (
            <div className="grid gap-1.5">
              <Label htmlFor="ap-edit-treat">Tratamiento</Label>
              <Select
                id="ap-edit-treat"
                value={treatmentId}
                disabled={pending}
                onChange={(e) => {
                  setTreatmentId(e.target.value);
                  run(() =>
                    updateAppointmentAction(item.id, { treatmentId: e.target.value || null }),
                  );
                }}
              >
                <option value="">Sin especificar</option>
                {treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[--color-border-subtle] pt-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="soft" size="sm">
                <Link href={`/dashboard/agenda/pacientes/${encodeURIComponent(item.patientKey)}`}>
                  <User className="h-4 w-4" /> Ficha del paciente
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link
                  href={`/dashboard/agenda/pacientes/${encodeURIComponent(item.patientKey)}?nota=${item.id}`}
                >
                  <NotebookPen className="h-4 w-4" /> Añadir nota clínica
                </Link>
              </Button>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReschedule((v) => !v)}>
                  <CalendarClock className="h-4 w-4" /> Mover
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending || item.status === 'CANCELLED'}
                  onClick={() =>
                    run(() => cancelAppointmentAction(item.id, 'Cancelada desde el panel'))
                  }
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancelar cita
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
