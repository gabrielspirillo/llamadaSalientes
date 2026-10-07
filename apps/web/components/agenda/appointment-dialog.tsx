'use client';

import { createAppointmentAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { PatientDialog } from '@/components/agenda/patient-dialog';
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
import { AlertTriangle, CalendarPlus, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface AppointmentDialogSeed {
  professionalId: string;
  dateKey: string;
  startMinute: number;
  /** Cita para un paciente concreto (viene de su ficha): va rellena. */
  patientId?: string | null;
  patientName?: string | null;
  patientPhone?: string | null;
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

/** Paciente-persona elegible al dar cita (lo devuelve `/api/agenda/patients`). */
export interface DialogPatient {
  id: string;
  /** Lo que se ve en el desplegable: "Martina Ruiz · 1 año y 8 meses". */
  label: string;
  /** El nombre limpio, sin la edad: es lo que va a la cita. */
  name: string;
  /** Teléfono del tutor, si lo hay. */
  phone: string | null;
  /** Titular del teléfono. */
  tutor: string | null;
}

async function fetchPatients(params: Record<string, string>): Promise<DialogPatient[]> {
  const res = await fetch(`/api/agenda/patients?${new URLSearchParams(params).toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { patients?: DialogPatient[] };
  return data.patients ?? [];
}

/** "Julieta Santalla Cruz" → nombre + apellidos, para precargar el alta. */
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
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
  patientSearch = false,
  onClose,
}: {
  seed: AppointmentDialogSeed;
  professionals: Professional[];
  treatments: Treatment[];
  /** Clínica con perfil: el paciente se elige de la ficha, buscando en el servidor. */
  patientSearch?: boolean;
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
  const [patientName, setPatientName] = React.useState(seed.patientName ?? '');
  const [patientId, setPatientId] = React.useState(seed.patientId ?? '');
  const [patientPhone, setPatientPhone] = React.useState(seed.patientPhone ?? '');
  const [patientEmail, setPatientEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [allowOutsideHours, setAllowOutsideHours] = React.useState(false);
  // Sólo aparece cuando el servidor rechazó la cita por una regla de reserva
  // (primeras visitas). Recepción decide; los agentes nunca pueden.
  const [policyBlocked, setPolicyBlocked] = React.useState(false);
  const [overridePolicy, setOverridePolicy] = React.useState(false);

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

  // Buscador de pacientes (clínicas con perfil). Busca en el servidor con
  // debounce: la lista entera no viaja a la página, y así no hay tope de 300.
  const [results, setResults] = React.useState<DialogPatient[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searched, setSearched] = React.useState('');
  const [listOpen, setListOpen] = React.useState(false);
  const [phoneKids, setPhoneKids] = React.useState<DialogPatient[]>([]);

  React.useEffect(() => {
    const q = patientName.trim();
    if (!patientSearch || patientId || q.length < 2) {
      setResults([]);
      setSearched('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      fetchPatients({ q })
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setSearched(q);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [patientSearch, patientId, patientName]);

  // Un teléfono que ya es de un tutor: se ofrecen sus niños antes de crear otro.
  React.useEffect(() => {
    const digits = patientPhone.replace(/\D/g, '');
    if (!patientSearch || patientId || digits.length < 9) {
      setPhoneKids([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchPatients({ phone: patientPhone })
        .then((found) => {
          if (!cancelled) setPhoneKids(found);
        })
        .catch(() => {
          if (!cancelled) setPhoneKids([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [patientSearch, patientId, patientPhone]);

  function onPatientNameChange(value: string) {
    setPatientName(value);
    setPatientId('');
    setListOpen(true);
  }

  function pickPatient(p: { id: string; name: string; phone: string | null }) {
    setPatientId(p.id);
    setPatientName(p.name);
    if (p.phone) setPatientPhone(p.phone);
    setListOpen(false);
    setResults([]);
    setPhoneKids([]);
  }

  // Con perfil la cita va siempre a una ficha: un nombre libre creaba otra
  // identidad (`tel:`/`anon:`) y el paciente salía duplicado en el listado.
  const needsPatient = patientSearch && !patientId;
  const noMatch =
    needsPatient &&
    !searching &&
    searched === patientName.trim() &&
    searched.length >= 2 &&
    results.length === 0;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createAppointmentAction({
        professionalId,
        treatmentId: treatmentId || null,
        patientId: patientId || null,
        patientName,
        patientPhone,
        patientEmail,
        startDateKey: dateKey,
        startMinute: toMinute(time),
        durationMinutes: duration,
        notes,
        allowOutsideHours,
        overridePolicy,
      });
      if (result.ok) {
        onClose();
        router.refresh();
      } else {
        setError(result.error);
        if (result.code === 'POLICY') setPolicyBlocked(true);
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
                        : 'bg-white text-zinc-700 ring-1 ring-(--color-border) hover:bg-brand-50',
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
              <div className="relative">
                <Input
                  id="ap-name"
                  value={patientName}
                  autoComplete="off"
                  onChange={(e) => onPatientNameChange(e.target.value)}
                  onFocus={() => setListOpen(true)}
                  onBlur={() => setTimeout(() => setListOpen(false), 150)}
                  placeholder={
                    patientSearch ? 'Busca por nombre, tutor o teléfono' : 'Nombre y apellidos'
                  }
                />
                {searching && (
                  <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
                )}
                {patientSearch && listOpen && results.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-[14px] bg-white p-1 shadow-lifted ring-1 ring-(--color-border)">
                    {results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickPatient(p)}
                          className="flex w-full flex-col rounded-[10px] px-3 py-2 text-left hover:bg-brand-50"
                        >
                          <span className="text-[13px] font-semibold text-zinc-800">{p.label}</span>
                          {(p.tutor || p.phone) && (
                            <span className="text-[12px] text-zinc-500">
                              {[p.tutor, p.phone].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {patientId && (
                <p className="text-[12px] font-semibold text-emerald-700">
                  Paciente de la ficha: la cita queda en su historia.
                </p>
              )}
              {noMatch && (
                <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-amber-50 p-2.5 text-[12px] text-amber-900">
                  <span>No existe ningún paciente con ese nombre.</span>
                  <PatientDialog
                    mode="create"
                    seed={{ ...splitName(patientName), phone: patientPhone }}
                    onCreated={(created) => pickPatient({ ...created, name: created.fullName })}
                    trigger={
                      <Button size="sm" variant="soft" type="button">
                        <UserPlus className="h-3.5 w-3.5" /> ¿Crear paciente nuevo?
                      </Button>
                    }
                  />
                </div>
              )}
              {phoneKids.length > 0 && (
                <div className="rounded-[14px] bg-brand-50 p-2.5 text-[12px] text-zinc-700">
                  <p className="mb-1.5 font-semibold">
                    Ese teléfono ya es de un tutor. ¿Es alguno de estos?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {phoneKids.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickPatient(p)}
                        className="rounded-full bg-white px-2.5 py-1 font-semibold ring-1 ring-(--color-border) hover:bg-brand-100"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
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

          {policyBlocked && (
            <label className="flex items-start gap-2 text-[13px] text-zinc-600">
              <input
                type="checkbox"
                checked={overridePolicy}
                onChange={(e) => setOverridePolicy(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Guardar igualmente aunque incumpla la regla de primeras visitas. Queda a criterio de
                recepción.
              </span>
            </label>
          )}

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
          {needsPatient && patientName.trim() && (
            <p className="mr-auto self-center text-[12px] text-zinc-500">
              Elige un paciente de la ficha o créalo.
            </p>
          )}
          <Button
            onClick={submit}
            disabled={pending || !patientName || !professionalId || needsPatient}
          >
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
