'use client';

import { useState, useTransition } from 'react';

import { connectTwilio, disconnect } from '../actions';

interface Props {
  initial: {
    accountSid: string;
    fromNumber: string;
  } | null;
}

export function TwilioConnectionForm({ initial }: Props) {
  const [accountSid, setAccountSid] = useState(initial?.accountSid ?? '');
  const [fromNumber, setFromNumber] = useState(initial?.fromNumber ?? '');
  const [authToken, setAuthToken] = useState('');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await connectTwilio({ accountSid, authToken, fromNumber });
      if (res.success) {
        setAuthToken('');
        setFeedback({ ok: true, msg: 'Conectado correctamente.' });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  function onDisconnect() {
    if (!confirm('¿Desconectar Twilio? Se borrará el Auth Token cifrado.')) return;
    startTransition(async () => {
      const res = await disconnect({ mode: 'TWILIO' });
      if (res.success) {
        setFeedback({ ok: true, msg: 'Desconectado.' });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">Account SID</label>
        <input
          type="text"
          value={accountSid}
          onChange={(e) => setAccountSid(e.target.value)}
          required
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 font-mono text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Auth Token <span className="text-zinc-400">(se cifra al guardar)</span>
        </label>
        <input
          type="password"
          value={authToken}
          onChange={(e) => setAuthToken(e.target.value)}
          required
          placeholder={initial ? 'Pega de nuevo para actualizar' : ''}
          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Número remitente (E.164)
        </label>
        <input
          type="text"
          value={fromNumber}
          onChange={(e) => setFromNumber(e.target.value)}
          required
          placeholder="+34123456789"
          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-zinc-500">
          El número WhatsApp sender aprobado en Twilio (sin prefijo
          <code className="mx-1 rounded bg-zinc-100 px-1">whatsapp:</code>).
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : initial ? 'Actualizar conexión' : 'Conectar'}
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
    </form>
  );
}
