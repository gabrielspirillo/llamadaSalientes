import { Card } from '@/components/ui/card';

type SkipRow = {
  id: string;
  ghlAppointmentId: string;
  ruleId: string | null;
  reason: string;
  details: unknown;
  createdAt: Date | string;
};

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

function fmt(d: Date | string): string {
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
      <Card className="p-4 text-center text-xs text-zinc-400">No hay omitidos en el histórico reciente.</Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
      {skipped.map((s) => (
        <Card key={s.id} className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700">
              {REASON_LABEL[s.reason] ?? s.reason}
            </span>
            <span className="text-[11px] text-zinc-400">{fmt(s.createdAt)}</span>
          </div>
          <p className="mt-1 truncate text-[11px] text-zinc-500">Cita: {s.ghlAppointmentId}</p>
        </Card>
      ))}
    </div>
  );
}
