'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

const STATUS_LABEL: Record<QueueRow['status'], string> = {
  ACTIVE: 'En espera',
  PAUSED: 'En pausa',
  FULFILLED: 'Adelantada',
  REMOVED: 'Retirado',
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
      <p className="py-10 text-center text-[13px] text-zinc-500">
        No hay pacientes en la lista. Cuando se detecte una cita futura que cumpla los requisitos,
        se añade sola.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-[--color-border] bg-white shadow-[var(--shadow-soft)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-[--color-border] bg-[#fafdfb] text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            <tr>
              <th className="text-left px-4 py-2.5">Paciente</th>
              <th className="text-left px-4 py-2.5">Tratamiento</th>
              <th className="text-left px-4 py-2.5">Cita actual</th>
              <th className="text-left px-4 py-2.5">En la lista desde</th>
              <th className="text-left px-4 py-2.5">Franja horaria</th>
              <th className="text-left px-4 py-2.5">Estado</th>
              <th className="text-right px-4 py-2.5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border-subtle]">
            {rows.map((r) => {
              const orig = new Date(r.originalStartTime);
              const created = new Date(r.createdAt);
              const disabled = pendingId === r.id || isPending;
              return (
                <tr key={r.id} className="transition-colors duration-200 hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{r.patientName}</div>
                    {r.contactPhone ? (
                      <div className="text-xs text-zinc-500">{r.contactPhone}</div>
                    ) : null}
                    {r.source === 'manual' ? (
                      <Badge tone="info" className="mt-1">
                        Añadido a mano
                      </Badge>
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
                    <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {STATUS_LABEL[r.status]}
                    </Badge>
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
                          if (confirm('¿Quitar al paciente de la lista de espera?')) {
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
    </div>
  );
}
