'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';

export type TreatmentToggleRow = {
  id: string;
  name: string;
  durationMinutes: number;
  active: boolean;
  waitlistEligible: boolean;
};

export function TreatmentsToggle({ rows }: { rows: TreatmentToggleRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function toggle(id: string, next: boolean) {
    setBusyId(id);
    try {
      const res = await fetch('/api/waitlist/treatments', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ treatmentId: id, waitlistEligible: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Error: ${data.error ?? res.statusText}`);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 py-4">
        No hay tratamientos cargados. Andá a la sección de Tratamientos para crearlos primero.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200/70 overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2.5">Tratamiento</th>
            <th className="text-left px-4 py-2.5">Duración</th>
            <th className="text-left px-4 py-2.5">Activo</th>
            <th className="text-right px-4 py-2.5">Elegible para waitlist</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-50/60">
              <td className="px-4 py-3 font-medium text-zinc-900">{r.name}</td>
              <td className="px-4 py-3 text-zinc-500">{r.durationMinutes} min</td>
              <td className="px-4 py-3">
                <Badge tone={r.active ? 'success' : 'neutral'}>
                  {r.active ? 'sí' : 'no'}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => toggle(r.id, !r.waitlistEligible)}
                  disabled={busyId === r.id}
                  className={`inline-flex h-6 w-10 items-center rounded-full transition-colors ${
                    r.waitlistEligible ? 'bg-emerald-600' : 'bg-zinc-200'
                  } disabled:opacity-50`}
                  aria-pressed={r.waitlistEligible}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      r.waitlistEligible ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
