import { Card } from '@/components/ui/card';
import type { SkipRow } from './Pipeline';

const REASON_LABEL: Record<string, string> = {
  no_phone: 'Sin teléfono',
  past_due: 'Fecha pasada',
  no_rules: 'Sin reglas configuradas',
  no_whatsapp: 'WhatsApp no conectado',
  no_voice_agent: 'Sin agente de voz',
  no_template: 'Sin plantilla',
  quiet_hours_full_day: 'Fuera de horario',
  opt_out: 'Opt-out',
  appointment_cancelled: 'Cita cancelada',
  duplicate: 'Duplicado',
};

const REASON_TONE: Record<string, string> = {
  no_phone: 'bg-amber-50 text-amber-700 border-amber-200',
  past_due: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  no_rules: 'bg-blue-50 text-blue-700 border-blue-200',
  no_whatsapp: 'bg-amber-50 text-amber-700 border-amber-200',
  no_voice_agent: 'bg-amber-50 text-amber-700 border-amber-200',
  no_template: 'bg-amber-50 text-amber-700 border-amber-200',
  quiet_hours_full_day: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  opt_out: 'bg-rose-50 text-rose-700 border-rose-200',
  appointment_cancelled: 'bg-rose-50 text-rose-700 border-rose-200',
  duplicate: 'bg-zinc-100 text-zinc-600 border-zinc-200',
};

function fmtAbsolute(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function SkipList({ skipped }: { skipped: SkipRow[] }) {
  if (skipped.length === 0) {
    return (
      <Card className="p-4 text-center text-xs text-zinc-400">
        No hay omitidos en el histórico reciente.
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
      {skipped.map((s) => {
        const reasonLabel = REASON_LABEL[s.reason] ?? s.reason;
        const reasonClass =
          REASON_TONE[s.reason] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
        return (
          <Card key={s.id} className="p-3">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${reasonClass}`}
              >
                {reasonLabel}
              </span>
              <span className="text-[11px] text-zinc-400 shrink-0">
                {fmtAbsolute(s.createdAt)}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium text-zinc-800 truncate">
              {s.treatmentName ?? 'Cita sin tratamiento'}
            </p>
            {s.appointmentStart && (
              <p className="mt-0.5 text-xs text-zinc-500 truncate">
                Cita: {fmtAbsolute(s.appointmentStart)}
              </p>
            )}
            <p
              className="mt-1 truncate font-mono text-[10px] text-zinc-400"
              title={s.ghlAppointmentId}
            >
              {s.ghlAppointmentId}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
