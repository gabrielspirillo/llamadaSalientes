'use client';

import { updateAppointmentAction } from '@/app/(dashboard)/dashboard/agenda/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type AppointmentStatus, STATUS_LABELS } from '@/lib/agenda/shared';
import { cn } from '@/lib/cn';
import { AlertTriangle, CalendarPlus, Check, DoorOpen, Loader2, Stethoscope } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

export interface TodayItem {
  /** Qué falta hacer hoy con este paciente: consentimiento, cobro, anamnesis… */
  label: string;
  href: string;
  tone: 'warn' | 'info';
}

/**
 * Lo accionable del día para recepción: la cita de hoy con su estado y los
 * botones para moverla (llegó · en gabinete · atendida), y la lista corta de
 * lo que queda pendiente con este paciente. Sin cita hoy, el botón de
 * agendar con el paciente ya puesto.
 */
export function TodayAppointmentCard({
  appointment,
  pendingItems,
  scheduleHref,
  canWrite,
}: {
  appointment: {
    id: string;
    timeLabel: string;
    professionalName: string;
    treatmentName: string | null;
    status: AppointmentStatus;
    isFirstVisit: boolean;
  } | null;
  pendingItems: TodayItem[];
  scheduleHref: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function setStatus(status: AppointmentStatus) {
    if (!appointment) return;
    setError(null);
    startTransition(async () => {
      const result = await updateAppointmentAction(appointment.id, { status });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  const status = appointment?.status;
  const closed = status === 'COMPLETED' || status === 'CANCELLED' || status === 'NO_SHOW';

  return (
    <div className="flex flex-col gap-3 border-b border-(--color-border-subtle) p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-600">Hoy</p>
          {appointment ? (
            <p className="mt-0.5 text-[16px] font-bold text-zinc-900">
              {appointment.timeLabel} · {appointment.professionalName}
              {appointment.treatmentName ? ` · ${appointment.treatmentName}` : ''}
              {appointment.isFirstVisit ? ' · 1ª visita' : ''}
            </p>
          ) : (
            <p className="mt-0.5 text-[15px] font-semibold text-zinc-700">Sin cita hoy</p>
          )}
        </div>
        {appointment ? (
          <Badge tone={closed ? 'neutral' : status === 'ARRIVED' || status === 'IN_PROGRESS' ? 'success' : 'info'}>
            {STATUS_LABELS[appointment.status]}
          </Badge>
        ) : (
          canWrite && (
            <Button asChild size="sm" variant="secondary">
              <Link href={scheduleHref} prefetch={false}>
                <CalendarPlus className="h-4 w-4" /> Agendar cita
              </Link>
            </Button>
          )
        )}
      </div>

      {appointment && canWrite && !closed && (
        <div className="flex flex-wrap gap-2">
          <StatusButton
            active={status === 'ARRIVED'}
            disabled={pending}
            onClick={() => setStatus('ARRIVED')}
            icon={<DoorOpen className="h-4 w-4" />}
          >
            Llegó
          </StatusButton>
          <StatusButton
            active={status === 'IN_PROGRESS'}
            disabled={pending}
            onClick={() => setStatus('IN_PROGRESS')}
            icon={<Stethoscope className="h-4 w-4" />}
          >
            En gabinete
          </StatusButton>
          <StatusButton
            active={false}
            disabled={pending}
            onClick={() => setStatus('COMPLETED')}
            icon={pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          >
            Atendida
          </StatusButton>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-[14px] bg-rose-50 p-3 text-[13px] text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {pendingItems.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pendingItems.map((it) => (
            <li key={it.label}>
              <Link
                href={it.href}
                prefetch={false}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1',
                  it.tone === 'warn'
                    ? 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100'
                    : 'bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100',
                )}
              >
                {it.label} <span aria-hidden>→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusButton({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ring-1 transition-colors disabled:opacity-60',
        active
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-white text-zinc-700 ring-(--color-border) hover:bg-brand-50',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
