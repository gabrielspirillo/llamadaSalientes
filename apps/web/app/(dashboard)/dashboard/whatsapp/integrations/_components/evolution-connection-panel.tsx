'use client';

import Image from 'next/image';
import { useState, useTransition } from 'react';

import { connectEvolution, disconnect } from '../actions';

interface Props {
  initial: {
    instanceName: string | null;
    qrBase64: string | null;
    status: string;
  } | null;
}

export function EvolutionConnectionPanel({ initial }: Props) {
  const [qrBase64, setQrBase64] = useState<string | null>(initial?.qrBase64 ?? null);
  const [instanceName, setInstanceName] = useState<string | null>(initial?.instanceName ?? null);
  const [status, setStatus] = useState<string>(initial?.status ?? 'NOT_CONFIGURED');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onConnect() {
    setFeedback(null);
    startTransition(async () => {
      const res = await connectEvolution();
      if (res.success) {
        setQrBase64(res.data.qrBase64);
        setInstanceName(res.data.instanceName);
        setStatus('PENDING');
        setFeedback({
          ok: true,
          msg: 'Instancia creada. Escaneá el QR desde WhatsApp para vincular el número.',
        });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  function onDisconnect() {
    if (!confirm('¿Desconectar Evolution? Se borrará el token de la instancia.')) return;
    startTransition(async () => {
      const res = await disconnect({ mode: 'EVOLUTION' });
      if (res.success) {
        setQrBase64(null);
        setStatus('DISCONNECTED');
        setFeedback({ ok: true, msg: 'Desconectado.' });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  return (
    <div className="space-y-3">
      {instanceName && (
        <div className="text-xs text-zinc-600">
          Instancia: <code className="rounded bg-zinc-100 px-1 py-0.5">{instanceName}</code>
        </div>
      )}

      {qrBase64 && status !== 'CONNECTED' && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-center">
          <p className="mb-2 text-xs text-zinc-600">
            Escaneá este QR desde WhatsApp → Dispositivos vinculados
          </p>
          <Image
            src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
            alt="QR de vinculación de Evolution"
            width={240}
            height={240}
            className="mx-auto"
            unoptimized
          />
        </div>
      )}

      {feedback && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onConnect}
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending
            ? 'Creando…'
            : status === 'CONNECTED'
              ? 'Recrear instancia'
              : initial
                ? 'Pedir nuevo QR'
                : 'Crear instancia + obtener QR'}
        </button>
        {initial && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="rounded-lg border border-red-200 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Desconectar
          </button>
        )}
      </div>
    </div>
  );
}
