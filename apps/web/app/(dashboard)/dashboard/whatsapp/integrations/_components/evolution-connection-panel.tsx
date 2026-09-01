'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import {
  connectEvolution,
  disconnect,
  disconnectChatwoot,
  getEvolutionConnectionState,
  setChatwoot,
} from '../actions';

interface Props {
  initial: {
    instanceName: string | null;
    qrBase64: string | null;
    status: string;
  } | null;
}

export function EvolutionConnectionPanel({ initial }: Props) {
  const [qrBase64, setQrBase64] = useState<string | null>(initial?.qrBase64 ?? null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(initial?.instanceName ?? null);
  const [status, setStatus] = useState<string>(initial?.status ?? 'NOT_CONFIGURED');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [showChatwoot, setShowChatwoot] = useState(false);

  // ── Auto-polling de estado mientras PENDING ────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (status !== 'PENDING') {
      stopPolling();
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const res = await getEvolutionConnectionState();
      if (res.success) {
        setStatus(res.data.status);
        if (res.data.status === 'CONNECTED') {
          setQrBase64(null);
          setPairingCode(null);
          setFeedback({ ok: true, msg: '¡Número vinculado! La instancia está conectada.' });
        }
      }
    }, 4000);
    return stopPolling;
  }, [status, stopPolling]);
  useEffect(() => stopPolling, [stopPolling]);

  function onConnect() {
    setFeedback(null);
    startTransition(async () => {
      const res = await connectEvolution();
      if (!res.success) {
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setInstanceName(res.data.instanceName);
      setQrBase64(res.data.qrBase64);
      setPairingCode(res.data.pairingCode);
      if (res.data.qrBase64 || res.data.pairingCode) {
        setStatus('PENDING');
        setFeedback({
          ok: true,
          msg: 'Escaneá el QR (o usá el código de vinculación) desde WhatsApp → Dispositivos vinculados.',
        });
      } else {
        // Sin QR ⇒ la instancia ya estaba conectada. Confirmamos el estado real.
        const st = await getEvolutionConnectionState();
        if (st.success) setStatus(st.data.status);
        setFeedback({ ok: true, msg: 'La instancia ya estaba conectada.' });
      }
    });
  }

  function onCheckStatus() {
    setFeedback(null);
    startTransition(async () => {
      const res = await getEvolutionConnectionState();
      if (res.success) {
        setStatus(res.data.status);
        setFeedback({
          ok: true,
          msg: `Estado servidor: ${res.data.state} → mapeado a ${res.data.status}`,
        });
      } else {
        setFeedback({ ok: false, msg: res.error });
      }
    });
  }

  function onDisconnect() {
    if (!confirm('¿Desconectar Evolution? Se cerrará la sesión WhatsApp en el servidor.')) return;
    startTransition(async () => {
      const res = await disconnect({ mode: 'EVOLUTION' });
      if (res.success) {
        setQrBase64(null);
        setPairingCode(null);
        setStatus('DISCONNECTED');
        setFeedback({ ok: true, msg: 'Desconectado. La sesión WhatsApp se cerró.' });
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
        <div className="rounded-lg border border-[--color-border] bg-zinc-50 p-4 text-center">
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
          {pairingCode && (
            <div className="mt-2 text-xs text-zinc-600">
              ¿No podés escanear? Usá este código:{' '}
              <code className="rounded bg-white px-2 py-0.5 font-mono text-sm">{pairingCode}</code>
            </div>
          )}
          {status === 'PENDING' && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Verificando estado cada 4s… El QR caduca en ~60s; volvé a tocar "Pedir QR" si tarda.
            </p>
          )}
        </div>
      )}

      {!qrBase64 && pairingCode && status !== 'CONNECTED' && (
        <div className="rounded-lg border border-[--color-border] bg-zinc-50 p-3 text-center text-xs">
          Código de vinculación:{' '}
          <code className="rounded bg-white px-2 py-0.5 font-mono text-base">{pairingCode}</code>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded px-3 py-2 text-xs ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status !== 'CONNECTED' && (
          <button
            type="button"
            onClick={onConnect}
            disabled={pending}
            className="rounded-full bg-[linear-gradient(120deg,#059669,#10b981)] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_rgba(16,185,129,0.7)] transition-all duration-300 hover:-translate-y-0.5 active:scale-95 hover:opacity-95 disabled:opacity-50"
          >
            {pending ? 'Procesando…' : 'Pedir QR'}
          </button>
        )}
        {initial && (
          <button
            type="button"
            onClick={onCheckStatus}
            disabled={pending}
            className="rounded-full border border-[--color-border] bg-white px-4 py-2 text-[13px] font-semibold text-zinc-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-200 hover:text-brand-700 active:scale-95 disabled:opacity-50"
          >
            Verificar estado
          </button>
        )}
        {initial && (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={pending}
            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Desconectar
          </button>
        )}
      </div>

      {/* Bridge Chatwoot — opcional. Cuando está activo, Evolution reenvía
          cada inbound de WhatsApp a Chatwoot Y a nuestro webhook (paralelo).
          Útil si el equipo prefiere atender desde Chatwoot en lugar del
          inbox propio. */}
      {initial && status === 'CONNECTED' && (
        <div className="mt-4 rounded-lg border border-[--color-border]">
          <button
            type="button"
            onClick={() => setShowChatwoot((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-zinc-700"
          >
            <span>Bridge Chatwoot (opcional)</span>
            <span>{showChatwoot ? '▾' : '▸'}</span>
          </button>
          {showChatwoot && <ChatwootBridgeForm />}
        </div>
      )}
    </div>
  );
}

function ChatwootBridgeForm() {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input = {
      url: String(fd.get('url') ?? ''),
      accountId: String(fd.get('accountId') ?? ''),
      token: String(fd.get('token') ?? ''),
      nameInbox: String(fd.get('nameInbox') ?? '') || undefined,
      signMsg: fd.get('signMsg') === 'on',
      reopenConversation: fd.get('reopenConversation') === 'on',
    };
    startTransition(async () => {
      const res = await setChatwoot(input);
      setFeedback(
        res.success
          ? { ok: true, msg: 'Chatwoot conectado. Mirá tu inbox "API" en Chatwoot.' }
          : { ok: false, msg: res.error },
      );
    });
  }

  function onDisconnect() {
    if (!confirm('¿Desconectar Chatwoot? Evolution dejará de reenviar mensajes.')) return;
    startTransition(async () => {
      const res = await disconnectChatwoot();
      setFeedback(
        res.success
          ? { ok: true, msg: 'Bridge Chatwoot desactivado.' }
          : { ok: false, msg: res.error },
      );
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 border-t border-[--color-border-subtle] p-3 text-xs"
    >
      <label className="block">
        <span className="block font-medium text-zinc-700">URL Chatwoot</span>
        <input
          name="url"
          required
          placeholder="https://chatwoot.tu-dominio.com"
          className="mt-0.5 w-full rounded border border-[--color-border] px-2 py-1"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block font-medium text-zinc-700">Account ID</span>
          <input
            name="accountId"
            required
            placeholder="1"
            className="mt-0.5 w-full rounded border border-[--color-border] px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="block font-medium text-zinc-700">Nombre del inbox</span>
          <input
            name="nameInbox"
            placeholder="cliniq-tenant-x"
            className="mt-0.5 w-full rounded border border-[--color-border] px-2 py-1"
          />
        </label>
      </div>
      <label className="block">
        <span className="block font-medium text-zinc-700">API Token (User → Profile)</span>
        <input
          name="token"
          required
          type="password"
          className="mt-0.5 w-full rounded border border-[--color-border] px-2 py-1"
        />
      </label>
      <div className="flex flex-wrap gap-3 pt-1 text-zinc-600">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name="signMsg" /> Firmar mensajes salientes
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name="reopenConversation" defaultChecked /> Reabrir conv si vuelve
        </label>
      </div>
      {feedback && (
        <div
          className={`rounded px-2 py-1 ${
            feedback.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}
        >
          {feedback.msg}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? 'Guardando…' : 'Conectar Chatwoot'}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={pending}
          className="rounded border border-[--color-border] bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-brand-50/50 disabled:opacity-50"
        >
          Desactivar bridge
        </button>
      </div>
    </form>
  );
}
