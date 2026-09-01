'use client';

import { useState, useTransition } from 'react';

import { connectCloud, disconnect } from '../actions';

interface Props {
  initial: { phoneNumberId: string; wabaId: string } | null;
}

export function CloudConnectionForm({ initial }: Props) {
  const [phoneNumberId, setPhoneNumberId] = useState(initial?.phoneNumberId ?? '');
  const [wabaId, setWabaId] = useState(initial?.wabaId ?? '');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await connectCloud({ phoneNumberId, wabaId, accessToken, appSecret });
      if (res.success) {
        setAccessToken('');
        setAppSecret('');
        setFeedback({ ok: true, msg: 'Conectado correctamente.' });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  function onDisconnect() {
    if (!confirm('¿Desconectar Meta Cloud API? Se borrarán los tokens cifrados.')) return;
    startTransition(async () => {
      const res = await disconnect({ mode: 'CLOUD' });
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
        <label className="mb-1 block text-xs font-medium text-zinc-700">Phone Number ID</label>
        <input
          type="text"
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          required
          className="w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">WABA ID</label>
        <input
          type="text"
          value={wabaId}
          onChange={(e) => setWabaId(e.target.value)}
          required
          className="w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Access Token <span className="text-zinc-400">(se cifra al guardar)</span>
        </label>
        <input
          type="password"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          required
          placeholder={initial ? 'Vuelve a pegarlo para actualizarlo' : ''}
          className="w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          App Secret <span className="text-zinc-400">(se cifra al guardar)</span>
        </label>
        <input
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          required
          className="w-full rounded-lg border border-[--color-border] px-3 py-1.5 text-sm focus:border-zinc-400 focus:outline-none"
        />
      </div>

      {feedback && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[linear-gradient(120deg,#059669,#10b981)] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(16,185,129,0.7)] transition-all duration-300 hover:-translate-y-0.5 active:scale-95 hover:opacity-95 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : initial ? 'Actualizar conexión' : 'Conectar'}
        </button>
        {initial && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="rounded-lg border border-rose-200 bg-white px-4 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Desconectar
          </button>
        )}
      </div>
    </form>
  );
}
