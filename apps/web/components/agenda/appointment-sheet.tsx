'use client';

import {
  cancelAppointmentAction,
  markAppointmentUnpaidAction,
  registerPaymentAction,
  rescheduleAppointmentAction,
  sendDayOfReminderNowAction,
  setAdvancePreferenceAction,
  updateAppointmentAction,
} from '@/app/(dashboard)/dashboard/agenda/actions';
import { type AvailabilityReason, NoSlotsNotice } from '@/components/agenda/no-slots-notice';
import { PatientSignalBadges } from '@/components/agenda/patient-signals';
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
import {
  AlertTriangle,
  ArrowUp,
  CalendarClock,
  CreditCard,
  Euro,
  Flag,
  Loader2,
  Minus,
  NotebookPen,
  Phone,
  Sparkles,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

const FLOW: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'];

const PAY_OPTIONS: { method: 'CARD' | 'CASH' | 'BIZUM' | 'TRANSFER'; label: string }[] = [
  { method: 'CARD', label: 'Datáfono' },
  { method: 'CASH', label: 'Efectivo' },
  { method: 'BIZUM', label: 'Bizum' },
  { method: 'TRANSFER', label: 'Transferencia' },
];

function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** Ficha de la cita: estado, reagendar, cancelar y salto a la historia clínica. */
export function AppointmentSheet({
  item,
  canWrite,
  treatments,
  todayKey,
  visibleStatuses = null,
  dayOfReminder = false,
  onClose,
}: {
  item: CalendarItem;
  canWrite: boolean;
  treatments: { id: string; name: string; durationMinutes: number }[];
  /** 'YYYY-MM-DD' de hoy en la clínica: la fecha del pago marcado aquí. */
  todayKey: string;
  /** Estados que usa la clínica. Null = todos. */
  visibleStatuses?: string[] | null;
  /** La clínica tiene recordatorio del día: botón para mandarlo ahora. */
  dayOfReminder?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [showReschedule, setShowReschedule] = React.useState(false);
  // Con perfil de atención se pregunta quién cancela: sólo la cancelación de
  // la familia es una bandera roja. Sin perfil, el botón cancela directamente.
  const askWhoCancels = item.signals !== null;
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [dateKey, setDateKey] = React.useState(item.dateKey);
  const [time, setTime] = React.useState(hhmm(item.startMinute));
  const [duration, setDuration] = React.useState(item.durationMinutes);
  const [treatmentId, setTreatmentId] = React.useState(item.treatmentId ?? '');
  const [allowOutsideHours, setAllowOutsideHours] = React.useState(false);
  const [customTime, setCustomTime] = React.useState(false);
  const [slots, setSlots] = React.useState<number[]>([]);
  const [loadingSlots, setLoadingSlots] = React.useState(false);
  const [slotReason, setSlotReason] = React.useState<AvailabilityReason>('OK');
  const [workingWeekdays, setWorkingWeekdays] = React.useState<number[]>([]);
  const [outsideBlocked, setOutsideBlocked] = React.useState(false);

  // Huecos libres del día elegido, sin contar la propia cita (si no, su hora y
  // las de al lado salían ocupadas). Se recargan al cambiar día o duración.
  React.useEffect(() => {
    if (!showReschedule || !dateKey || !duration) return;
    let cancelled = false;
    setLoadingSlots(true);
    const params = new URLSearchParams({
      professionalId: item.professionalId,
      from: dateKey,
      to: dateKey,
      duration: String(duration),
      exclude: item.id,
      ...(item.firstVisit ? { firstVisit: '1' } : {}),
    });
    fetch(`/api/agenda/availability?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then(
        (data: {
          slots?: { dateKey: string; startMinute: number }[];
          reason?: AvailabilityReason;
          workingWeekdays?: number[];
        }) => {
          if (cancelled) return;
          setSlots(
            (data.slots ?? []).filter((x) => x.dateKey === dateKey).map((x) => x.startMinute),
          );
          setSlotReason(data.reason ?? 'OK');
          setWorkingWeekdays(data.workingWeekdays ?? []);
        },
      )
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showReschedule, dateKey, duration, item.id, item.professionalId, item.firstVisit]);

  const flow = FLOW.filter((st) => !visibleStatuses || visibleStatuses.includes(st));
  const showNoShow = !visibleStatuses || visibleStatuses.includes('NO_SHOW');
  const [amount, setAmount] = React.useState(
    centsToInput(item.payment?.amountCents ?? item.treatmentPriceCents),
  );
  const [advanceNote, setAdvanceNote] = React.useState(item.advanceNote ?? '');
  const [reminderSent, setReminderSent] = React.useState(false);

  /** Como `run`, pero la hoja sigue abierta: pago y adelanto se ajustan sin salir. */
  function runStay(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function move(forceOutsideHours: boolean) {
    const [h, m] = time.split(':').map(Number);
    setError(null);
    if (forceOutsideHours) setAllowOutsideHours(true);
    startTransition(async () => {
      const result = await rescheduleAppointmentAction(item.id, {
        startDateKey: dateKey,
        startMinute: (h ?? 9) * 60 + (m ?? 0),
        durationMinutes: duration,
        allowOutsideHours: allowOutsideHours || forceOutsideHours,
      });
      if (result.ok) {
        router.refresh();
        onClose();
      } else {
        setError(result.error);
        setOutsideBlocked(result.code === 'OUTSIDE_HOURS');
      }
    });
  }

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
            {item.signals && (
              <PatientSignalBadges
                size="sm"
                redFlags={item.signals.redFlags}
                hesitant={item.signals.hesitant}
                hesitantNote={item.signals.hesitantNote}
              />
            )}
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
                {flow.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => updateAppointmentAction(item.id, { status: s }))}
                    className={cn(
                      'rounded-full px-3 py-1 text-[12px] font-semibold transition-colors',
                      item.status === s
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-zinc-600 ring-1 ring-(--color-border) hover:bg-brand-50',
                    )}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
                {showNoShow && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => updateAppointmentAction(item.id, { status: 'NO_SHOW' }))
                    }
                    className={cn(
                      'rounded-full px-3 py-1 text-[12px] font-semibold',
                      item.status === 'NO_SHOW'
                        ? 'bg-red-600 text-white'
                        : 'bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50',
                    )}
                  >
                    No se presentó
                  </button>
                )}
              </div>
            </div>
          )}

          {canWrite && item.status !== 'CANCELLED' && (
            <div className="rounded-[14px] border border-(--color-border) p-3">
              <p className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                Pago
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] normal-case tracking-normal',
                    item.payment?.paid
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-zinc-100 text-zinc-600',
                  )}
                >
                  {item.payment?.paid
                    ? `Pagado${
                        item.payment.method
                          ? ` · ${PAY_OPTIONS.find((o) => o.method === item.payment?.method)?.label ?? ''}`
                          : ''
                      }`
                    : 'No pagado'}
                </span>
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="grid w-28 gap-1">
                  <Label htmlFor="pay-amount">Importe (€)</Label>
                  <Input
                    id="pay-amount"
                    inputMode="decimal"
                    value={amount}
                    placeholder="0"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {PAY_OPTIONS.map((o) => {
                  const active = item.payment?.paid && item.payment.method === o.method;
                  return (
                    <button
                      key={o.method}
                      type="button"
                      disabled={pending || !amount.trim()}
                      onClick={() =>
                        runStay(() =>
                          registerPaymentAction({
                            appointmentId: item.id,
                            amount,
                            paidOn: todayKey,
                            paymentMethod: o.method,
                          }),
                        )
                      }
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50',
                        active
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white text-zinc-700 ring-1 ring-(--color-border) hover:bg-emerald-50',
                      )}
                    >
                      {o.method === 'CARD' ? (
                        <CreditCard className="h-3.5 w-3.5" />
                      ) : o.method === 'CASH' ? (
                        <Euro className="h-3.5 w-3.5" />
                      ) : null}
                      {o.label}
                    </button>
                  );
                })}
                {item.payment?.paid && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => runStay(() => markAppointmentUnpaidAction(item.id))}
                    className="rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-600 ring-1 ring-(--color-border) hover:bg-zinc-50"
                  >
                    No pagado
                  </button>
                )}
              </div>
            </div>
          )}

          {canWrite && dayOfReminder && ['SCHEDULED', 'CONFIRMED'].includes(item.status) && (
            <div className="flex items-center justify-between gap-3 rounded-[14px] border border-(--color-border) p-3">
              <p className="text-[13px] text-zinc-600">
                {reminderSent
                  ? 'Recordatorio enviado por WhatsApp.'
                  : 'Recordatorio del día con Confirmar / Modificar / Cancelar.'}
              </p>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  runStay(async () => {
                    const r = await sendDayOfReminderNowAction(item.id);
                    if (r.ok) setReminderSent(true);
                    return r;
                  })
                }
              >
                Enviar ahora
              </Button>
            </div>
          )}

          {canWrite && item.status !== 'CANCELLED' && (
            <div className="rounded-[14px] border border-(--color-border) p-3">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                Si se libera un hueco antes
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    {
                      value: 'ACCEPTS',
                      label: 'Quiere adelantar',
                      icon: <ArrowUp className="h-3.5 w-3.5" />,
                    },
                    {
                      value: 'NO_MOVE',
                      label: 'No mover',
                      icon: <Minus className="h-3.5 w-3.5" />,
                    },
                    { value: null, label: 'Sin indicar', icon: null },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      runStay(() =>
                        setAdvancePreferenceAction(item.id, {
                          preference: o.value,
                          note: o.value === 'ACCEPTS' ? advanceNote : null,
                        }),
                      )
                    }
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition-colors',
                      item.advancePreference === o.value
                        ? o.value === 'ACCEPTS'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-zinc-700 text-white'
                        : 'bg-white text-zinc-700 ring-1 ring-(--color-border) hover:bg-zinc-50',
                    )}
                  >
                    {o.icon}
                    {o.label}
                  </button>
                ))}
              </div>
              {item.advancePreference === 'ACCEPTS' && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="grid min-w-[200px] flex-1 gap-1">
                    <Label htmlFor="adv-note">Horario al que puede venir</Label>
                    <Input
                      id="adv-note"
                      value={advanceNote}
                      maxLength={200}
                      placeholder="Ej.: desde las 18h, martes y jueves"
                      onChange={(e) => setAdvanceNote(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || advanceNote === (item.advanceNote ?? '')}
                    onClick={() =>
                      runStay(() =>
                        setAdvancePreferenceAction(item.id, {
                          preference: 'ACCEPTS',
                          note: advanceNote,
                        }),
                      )
                    }
                  >
                    Guardar horario
                  </Button>
                </div>
              )}
            </div>
          )}

          {canWrite && showReschedule && (
            <div className="rounded-[14px] border border-(--color-border) p-3">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-zinc-500">
                Mover la cita
              </p>
              <div className="grid gap-1.5 sm:max-w-[240px]">
                <Label htmlFor="rs-date">Día</Label>
                <Input
                  id="rs-date"
                  type="date"
                  value={dateKey}
                  onChange={(e) => setDateKey(e.target.value)}
                />
              </div>

              {/* Huecos libres del día elegido: un clic y listo, como en Nueva cita. */}
              <div className="mt-3 rounded-[14px] bg-zinc-50 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-600">
                  <Sparkles className="h-3.5 w-3.5" /> Huecos libres ese día
                  <span className="font-normal text-zinc-500">· {duration} min</span>
                  {loadingSlots && <Loader2 className="h-3 w-3 animate-spin" />}
                </div>
                {slots.length === 0 ? (
                  <NoSlotsNotice
                    loading={loadingSlots}
                    reason={slotReason}
                    workingWeekdays={workingWeekdays}
                    forceLabel="Moverla igualmente"
                    onForce={() => {
                      setCustomTime(true);
                      setAllowOutsideHours(true);
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {slots.slice(0, 30).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setTime(hhmm(m))}
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums transition-colors',
                          time === hhmm(m)
                            ? 'bg-brand-600 text-white'
                            : 'bg-white text-zinc-700 ring-1 ring-(--color-border) hover:bg-brand-50',
                        )}
                      >
                        {hhmm(m)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setCustomTime((v) => !v)}
                  className="text-[12px] font-semibold text-brand-700 hover:underline"
                  aria-expanded={customTime}
                >
                  {customTime ? 'Ocultar personalizar' : 'Personalizar hora o duración'}
                </button>
              </div>
              {customTime && (
                <div className="mt-2 grid gap-3 rounded-[14px] border border-(--color-border) p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="rs-time">Hora</Label>
                      <Input
                        id="rs-time"
                        type="time"
                        step={300}
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="rs-dur">Duración (min)</Label>
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
                  <label className="flex items-start gap-2 text-[13px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={allowOutsideHours}
                      onChange={(e) => setAllowOutsideHours(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Permitir fuera del horario (urgencias). Se sigue comprobando que no se pise
                      con otra cita.
                    </span>
                  </label>
                </div>
              )}

              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReschedule(false)}>
                  Cerrar
                </Button>
                {outsideBlocked && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !time}
                    onClick={() => move(true)}
                  >
                    Moverla igualmente fuera de horario
                  </Button>
                )}
                <Button size="sm" disabled={pending || !time} onClick={() => move(false)}>
                  Mover a las {time || '--:--'}
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

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-border-subtle) pt-4">
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
                  aria-expanded={askWhoCancels ? confirmCancel : undefined}
                  onClick={() =>
                    askWhoCancels
                      ? setConfirmCancel((v) => !v)
                      : run(() => cancelAppointmentAction(item.id, 'Cancelada desde el panel'))
                  }
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancelar cita
                </Button>
              </div>
            )}
          </div>

          {canWrite && askWhoCancels && confirmCancel && item.status !== 'CANCELLED' && (
            <div className="rounded-[14px] border border-rose-200 bg-rose-50/60 p-3">
              <p className="text-[13px] font-semibold text-zinc-800">¿Quién cancela la cita?</p>
              <p className="mb-2.5 text-[12px] text-zinc-600">
                Si cancela la familia, le suma una bandera roja.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      cancelAppointmentAction(item.id, 'Cancelada por la familia', 'PATIENT'),
                    )
                  }
                >
                  <Flag className="h-4 w-4" /> La familia
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      cancelAppointmentAction(item.id, 'Cancelada por la clínica', 'CLINIC'),
                    )
                  }
                >
                  La clínica
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
