'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type OfferRow = {
  id: string;
  patientName: string;
  contactPhone: string | null;
  channel: 'WHATSAPP' | 'VOICE';
  driverScope: string;
  status:
    | 'PENDING'
    | 'SENT'
    | 'ACCEPTED'
    | 'DECLINED'
    | 'EXPIRED'
    | 'CANCELLED'
    | 'SUPERSEDED';
  sentAt: string | null;
  expiresAt: string;
  respondedAt: string | null;
  oldAppointmentTime: string;
  newSlotTime: string;
  treatmentName: string | null;
  errorMessage: string | null;
};

const STATUS_TONE: Record<OfferRow['status'], 'neutral' | 'success' | 'warn' | 'danger' | 'info'> = {
  PENDING: 'info',
  SENT: 'info',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  EXPIRED: 'warn',
  CANCELLED: 'neutral',
  SUPERSEDED: 'neutral',
};

export function OffersTable({ rows, tz }: { rows: OfferRow[]; tz: string }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function cancelOffer(id: string) {
    if (!confirm('¿Cancelar manualmente esta oferta?')) return;
    setPendingId(id);
    try {
      const res = await fetch(`/api/waitlist/offers/${id}/cancel`, { method: 'POST' });
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
        No hay ofertas en curso. Cuando un slot se libere y haya match, aparecerá acá.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200/70 overflow-hidden bg-white">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-zinc-600 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2.5">Paciente</th>
            <th className="text-left px-4 py-2.5">Cita vieja → Slot ofrecido</th>
            <th className="text-left px-4 py-2.5">Tratamiento</th>
            <th className="text-left px-4 py-2.5">Canal</th>
            <th className="text-left px-4 py-2.5">Estado</th>
            <th className="text-left px-4 py-2.5">Vence</th>
            <th className="text-right px-4 py-2.5">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => {
            const oldT = new Date(r.oldAppointmentTime);
            const newT = new Date(r.newSlotTime);
            const expires = new Date(r.expiresAt);
            const now = Date.now();
            const mins = Math.round((expires.getTime() - now) / 60_000);
            const fmt = (d: Date) =>
              d.toLocaleString('es-ES', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: tz,
              });
            const isActive = r.status === 'PENDING' || r.status === 'SENT';
            return (
              <tr key={r.id} className="hover:bg-zinc-50/60">
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-900">{r.patientName}</div>
                  {r.contactPhone ? (
                    <div className="text-xs text-zinc-500">{r.contactPhone}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs text-zinc-500">{fmt(oldT)}</div>
                  <div className="font-medium">↓</div>
                  <div className="text-zinc-900">{fmt(newT)}</div>
                </td>
                <td className="px-4 py-3">{r.treatmentName ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone="neutral">{r.channel}</Badge>
                  <div className="text-xs text-zinc-500 mt-1">{r.driverScope}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  {r.errorMessage ? (
                    <div className="text-xs text-rose-600 mt-1">{r.errorMessage}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {isActive
                    ? mins > 0
                      ? `${mins} min`
                      : 'expirado'
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {isActive ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingId === r.id || isPending}
                      onClick={() => cancelOffer(r.id)}
                    >
                      Cancelar
                    </Button>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
