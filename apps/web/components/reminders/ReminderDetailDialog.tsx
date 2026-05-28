'use client';

import { useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Reminder, Rule } from './Pipeline';

type Vars = {
  contact?: { firstName?: string; fullName?: string; phone?: string };
  appointment?: {
    treatment?: string;
    date?: string;
    time?: string;
    dateTime?: string;
    durationMinutes?: string;
  };
  clinic?: { name?: string; address?: string; phone?: string };
};

function getVars(snapshot: unknown): Vars {
  if (!snapshot || typeof snapshot !== 'object') return {};
  return (snapshot as { vars?: Vars }).vars ?? {};
}

const STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'success' | 'warn' | 'danger' | 'info' }> = {
  SCHEDULED: { label: 'Programado', tone: 'info' },
  SENT: { label: 'Enviado', tone: 'neutral' },
  DELIVERED: { label: 'Entregado', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmado', tone: 'success' },
  RESCHEDULE_REQUESTED: { label: 'Pidió reagendar', tone: 'warn' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
  NO_RESPONSE: { label: 'Sin respuesta', tone: 'warn' },
  SKIPPED: { label: 'Omitido', tone: 'neutral' },
  FAILED: { label: 'Falló', tone: 'danger' },
};

function fmt(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function offsetToHuman(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / 60 / 24}d antes`;
  if (minutes % 60 === 0) return `${minutes / 60}h antes`;
  return `${minutes}m antes`;
}

export function ReminderDetailDialog({
  reminder,
  rule,
  onClose,
}: {
  reminder: Reminder;
  rule: Rule | null;
  onClose: () => void;
}) {
  const vars = getVars(reminder.payloadSnapshot);
  const status = STATUS_LABEL[reminder.status] ?? { label: reminder.status, tone: 'neutral' as const };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function mark(action: 'confirm' | 'reschedule' | 'cancel') {
    if (
      !confirm(
        action === 'confirm'
          ? '¿Confirmar manualmente este recordatorio?'
          : action === 'cancel'
            ? '¿Marcar como cancelado y cancelar la cita en GHL?'
            : '¿Marcar como "pidió reagendar"?',
      )
    )
      return;
    const res = await fetch(`/api/reminders/${reminder.id}/mark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      alert(`✓ Marcado como ${action}.`);
      onClose();
    } else {
      alert(`No se pudo marcar.\n\nMotivo: ${data.error ?? 'error desconocido'}`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-zinc-100 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-900 truncate">
              {vars.contact?.fullName || vars.contact?.firstName || 'Paciente'}
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500 truncate">
              {vars.appointment?.treatment || 'Cita'} · {vars.appointment?.dateTime || '—'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge tone={status.tone}>{status.label}</Badge>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm">
          <Section title="Paciente">
            <Row label="Nombre" value={vars.contact?.fullName} />
            <Row label="Teléfono" value={vars.contact?.phone} />
          </Section>

          <Section title="Cita">
            <Row label="Tratamiento" value={vars.appointment?.treatment} />
            <Row label="Fecha" value={vars.appointment?.date} />
            <Row label="Hora" value={vars.appointment?.time} />
            <Row label="Duración" value={vars.appointment?.durationMinutes ? `${vars.appointment.durationMinutes} min` : null} />
            <Row label="ID GHL" value={reminder.ghlAppointmentId} mono />
          </Section>

          <Section title="Clínica">
            <Row label="Nombre" value={vars.clinic?.name} />
            <Row label="Dirección" value={vars.clinic?.address} />
            <Row label="Teléfono" value={vars.clinic?.phone} />
          </Section>

          <Section title="Recordatorio">
            <Row label="Canal" value={reminder.channelPlanned === 'VOICE' ? 'Voz' : 'WhatsApp'} />
            {reminder.channelUsed && reminder.channelUsed !== reminder.channelPlanned && (
              <Row
                label="Canal usado"
                value={reminder.channelUsed === 'VOICE' ? 'Voz (fallback)' : 'WhatsApp (fallback)'}
              />
            )}
            <Row
              label="Regla"
              value={rule ? rule.label ?? offsetToHuman(rule.offsetMinutes) : '—'}
            />
            <Row label="Programado para" value={fmt(reminder.scheduledFor)} />
            <Row label="Enviado" value={fmt(reminder.sentAt)} />
            <Row label="Respondido" value={fmt(reminder.respondedAt)} />
          </Section>
        </div>

        {reminder.failureReason && (
          <div className="border-t border-zinc-100 p-5">
            <p className="text-xs font-medium text-rose-600">⚠ Error</p>
            <p className="mt-1 text-sm text-rose-700">{reminder.failureReason}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 p-5">
          <Button size="sm" onClick={() => mark('confirm')}>
            Marcar como confirmado
          </Button>
          <Button size="sm" variant="secondary" onClick={() => mark('reschedule')}>
            Marcar reagendar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => mark('cancel')}>
            Marcar cancelado
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`min-w-0 truncate ${mono ? 'font-mono text-[11px]' : ''} text-zinc-800`} title={value ?? ''}>
        {value || '—'}
      </dd>
    </div>
  );
}
