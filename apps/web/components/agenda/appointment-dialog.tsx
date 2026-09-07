'use client';

import { createAppointmentAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { AlertTriangle, CalendarPlus, Loader2, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface AppointmentDialogSeed {
  professionalId: string;
  dateKey: string;
  startMinute: number;
}

interface Professional {
  id: string;
  fullName: string;
  color: string;
}

interface Treatment {
  id: string;
  name: string;
  durationMinutes: number;
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function toMinute(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 9) * 60 + (m ?? 0);
}

/**
 * Alta de cita desde el calendario.
 *
 * Manda el día y el minuto LOCALES, no un instante: el servidor los convierte
 * con la timezone de la clínica. Si el navegador hiciera la conversión, una
 * recepcionista de viaje agendaría a la hora de donde esté.
 */
export function AppointmentDialog({
  seed,
  professionals,
  treatments,
  onClose,
}: {
  seed: AppointmentDialogSeed;
  professionals: Professional[];
  treatments: Treatment[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [professionalId, setProfessionalId] = React.useState(
    seed.professionalId || (professionals[0]?.id ?? ''),
  );
  const [treatmentId, setTreatmentId] = React.useState('');
  const [dateKey, setDateKey] = React.useState(seed.dateKey);
  const [time, setTime] = React.useState(hhmm(seed.startMinute));
  const [duration, setDuration] = React.useState(30);
  const [patientName, setPatientName] = React.useState('');
  const [patientPhone, setPatientPhone] = React.useState('');
  const [patientEmail, setPatientEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [allowOutsideHours, setAllowOutsideHours] = React.useState(false);

  const [slots, setSlots] = React.useState<{ startMinute: number; dateKey: string }[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);

  // Huecos sugeridos del día elegido: es lo que evita que recepción tenga que
  // adivinar dónde cabe la cita.
  React.useEffect(() => {
    if (!professionalId) return;
    let cancelled = false;
    setLoadingSlots(true);
    const params = new URLSearchParams({
      professionalId,
      from: dateKey,
      to: dateKey,
      duration: String(duration),
    });
    fetch(`/api/agenda/availability?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((data: { slots?: { dateKey: string; startMinute: number }[] }) => {
        if (!cancelled) setSlots(data.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [professionalId, dateKey, duration]);

  function onTreatmentChange(id: string) {
    setTreatmentId(id);
    const t = treatments.find((x) => x.id === id);
    if (t) setDuration(t.durationMinutes);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createAppointmentAction({
        professionalId,
        treatmentId: treatmentId || null,
        patientName,
        patientPhone,
        patientEmail,
        startDateKey: dateKey,
        startMinute: toMinute(time),
        durationMinutes: duration,
        notes,
        allowOutsideHours,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>
            Se guarda en la agenda de la plataforma y los agentes virtuales la ven al instante.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ap-prof">Profesional</Label>
              <Select
                id="ap-prof"
                value={professionalId}
                onChange={(e) => setProfessionalId(e.target.value)}
              >
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-treat">Tratamiento</Label>
              <Select
                id="ap-treat"
                value={treatmentId}
                onChange={(e) => onTreatmentChange(e.target.value)}
              >
                <option value="">Sin especificar</option>
                {treatments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.durationMinutes} min
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ap-date">Día</Label>
              <Input
                id="ap-date"
                type="date"
                value={dateKey}
                onChange={(e) => setDateKey(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-time">Hora</Label>
              <Input
                id="ap-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-dur">Duración (min)</Label>
              <Input
                id="ap-dur"
                type="number"
                min={5}
                max={600}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Huecos libres del día */}
          <div className="rounded-[14px] bg-zinc-50 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600">
              <Sparkles className="h-3.5 w-3.5" /> Huecos libres ese día
              {loadingSlots && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {slots.length === 0 ? (
              <p className="text-[12px] text-zinc-500">
                {loadingSlots
                  ? 'Buscando…'
                  : 'No quedan huecos con esa duración. Puedes encajarla igualmente marcando “fuera de horario”.'}
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slots.slice(0, 24).map((s) => (
                  <button
                    key={`${s.dateKey}-${s.startMinute}`}
                    type="button"
                    onClick={() => setTime(hhmm(s.startMinute))}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums transition-colors',
                      time === hhmm(s.startMinute)
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-zinc-700 ring-1 ring-[--color-border] hover:bg-brand-50',
                    )}
                  >
                    {hhmm(s.startMinute)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ap-name">Paciente</Label>
              <Input
                id="ap-name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Nombre y apellidos"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-phone">Teléfono</Label>
              <Input
                id="ap-phone"
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                placeholder="+34 600 000 000"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ap-email">Email (opcional)</Label>
            <Input
              id="ap-email"
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ap-notes">Notas para el equipo</Label>
            <Textarea
              id="ap-notes"
              className="min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo, avisos, alergias…"
            />
          </div>

          <label className="flex items-start gap-2 text-[13px] text-zinc-600">
            <input
              type="checkbox"
              checked={allowOutsideHours}
              onChange={(e) => setAllowOutsideHours(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Permitir fuera del horario del profesional (urgencias). Se sigue comprobando que no se
              pise con otra cita.
            </span>
          </label>

          {error && (
            <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>

        <DialogFooter className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !patientName || !professionalId}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CalendarPlus className="h-4 w-4" />
            )}
            Guardar cita
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
