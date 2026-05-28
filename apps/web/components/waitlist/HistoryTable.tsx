import { Badge } from '@/components/ui/badge';

export type HistoryRow = {
  id: string;
  patientName: string;
  oldAppointmentTime: string;
  newAppointmentTime: string | null;
  treatmentName: string | null;
  channel: 'WHATSAPP' | 'VOICE';
  source: 'outbound' | 'inbound' | 'whatsapp' | null;
  revenueCents: number;
  currency: string;
  acceptedAt: string;
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: currency || 'EUR',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function HistoryTable({
  rows,
  tz,
  totals,
}: {
  rows: HistoryRow[];
  tz: string;
  totals: { count: number; revenueCents: number; currency: string };
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200/70 bg-white p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Citas adelantadas
          </div>
          <div className="text-2xl font-semibold text-zinc-900">{totals.count}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Revenue recuperado
          </div>
          <div className="text-2xl font-semibold text-emerald-600">
            {money(totals.revenueCents, totals.currency)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Promedio por cita
          </div>
          <div className="text-2xl font-semibold text-zinc-900">
            {totals.count > 0
              ? money(Math.round(totals.revenueCents / totals.count), totals.currency)
              : '—'}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 py-6 text-center">
          Todavía no hay citas adelantadas. El histórico se llena a medida que los pacientes aceptan ofertas.
        </p>
      ) : (
        <div className="rounded-xl border border-zinc-200/70 overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5">Paciente</th>
                <th className="text-left px-4 py-2.5">Cita original → Cita nueva</th>
                <th className="text-left px-4 py-2.5">Tratamiento</th>
                <th className="text-left px-4 py-2.5">Canal</th>
                <th className="text-left px-4 py-2.5">Cerrada</th>
                <th className="text-right px-4 py-2.5">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => {
                const oldT = new Date(r.oldAppointmentTime);
                const newT = r.newAppointmentTime ? new Date(r.newAppointmentTime) : null;
                const closed = new Date(r.acceptedAt);
                const fmt = (d: Date) =>
                  d.toLocaleString('es-ES', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: tz,
                  });
                return (
                  <tr key={r.id} className="hover:bg-zinc-50/60">
                    <td className="px-4 py-3 font-medium text-zinc-900">{r.patientName}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-zinc-500">{fmt(oldT)}</div>
                      <div className="font-medium">↓</div>
                      <div className="text-zinc-900">{newT ? fmt(newT) : '—'}</div>
                    </td>
                    <td className="px-4 py-3">{r.treatmentName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">{r.channel}</Badge>
                      {r.source ? (
                        <div className="text-xs text-zinc-500 mt-1">via {r.source}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {closed.toLocaleDateString('es-ES', {
                        day: 'numeric',
                        month: 'short',
                        timeZone: tz,
                      })}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-700">
                      {money(r.revenueCents, r.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
