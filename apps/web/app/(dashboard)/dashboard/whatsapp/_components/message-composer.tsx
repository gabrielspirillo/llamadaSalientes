'use client';

import { useState, useTransition } from 'react';
import { sendManualMessage } from '../actions';

interface Props {
  conversationId: string;
  disabled?: boolean;
}

function generateNonce(): string {
  // crypto.randomUUID() está disponible en navegadores modernos.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function MessageComposer({ conversationId, disabled }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const res = await sendManualMessage({
        conversationId,
        text: trimmed,
        clientNonce: generateNonce(),
        takeoverHours: 2,
      });
      if (res.success) {
        setText('');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-zinc-200 bg-white p-3">
      {error && (
        <div className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            disabled
              ? 'Conversación cerrada — no se pueden enviar mensajes'
              : 'Escribe un mensaje para el contacto…'
          }
          disabled={disabled || pending}
          rows={2}
          className="flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSubmit(e as unknown as React.FormEvent);
            }
          }}
        />
        <button
          type="submit"
          disabled={disabled || pending || !text.trim()}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {pending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      <p className="mt-1 text-[10px] text-zinc-400">
        Ctrl+Enter para enviar · Tomar conversación por 2 h automáticamente al enviar.
      </p>
    </form>
  );
}
