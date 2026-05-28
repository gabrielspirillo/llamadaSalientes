'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type QueueRow = {
  id: string;
  patientName: string;
  contactPhone: string | null;
  treatmentName: string | null;
  originalStartTime: string;
  createdAt: string;
  status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'REMOVED';
  source: 'auto' | 'manual';
  notes: string | null;
  preferredWindow: { start: string | null; end: string | null };
};

export function QueueTable({ rows, tz }: { rows: QueueRow[]; tz: string }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function update(id: string, body: Record<string, unknown>) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/waitlist/entries/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 py-6 text-center">
        No hay pacientes en la cola. Al detectar una cita futura elegible, se agregan automáticamente.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200/70 overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2.5">Paciente</th>
            <th className="text-left px-4 py-2.5">Tratamiento</th>
            <th className="text-left px-4 py-2.5">Cita actual</th>
            <th className="text-left px-4 py-2.5">En cola desde</th>
            <th className="text-left px-4 py-2.5">Ventana</th>
            <th className="text-left px-4 py-2.5">Estado</th>
            <th className="text-right px-4 py-2.5">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const orig = new Date(r.originalStartTime);
            const created = new Date(r.createdAt);
            const disabled = pendingId === r.id || isPending;
            return (
              <tr key={r.id} className="hover:bg-zinc-50/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-900">{r.patientName}</div>
                  {r.contactPhone ? (
                    <div className="text-xs text-zinc-500">{r.contactPhone}</div>
                  ) : null}
                  {r.source === 'manual' ? (
                    <Badge tone="info" className="mt-1">manual</Badge>
                  ) : null}
                </td>
                <td className="px-4 py-3">{r.treatmentName ?? '—'}</td>
                <td className="px-4 py-3">
                  {orig.toLocaleString('es-ES', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: tz,
                  })}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {created.toLocaleDateString('es-ES', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: tz,
                  })}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {r.preferredWindow.start && r.preferredWindow.end
                    ? `${r.preferredWindow.start}–${r.preferredWindow.end}`
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>{r.status}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {r.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => update(r.id, { status: 'PAUSED' })}
                      >
                        Pausar
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => update(r.id, { status: 'ACTIVE' })}
                      >
                        Reactivar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => {
                        if (confirm('¿Quitar al paciente de la waitlist?')) {
                          void update(r.id, { status: 'REMOVED' });
                        }
                      }}
                    >
                      Quitar
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
