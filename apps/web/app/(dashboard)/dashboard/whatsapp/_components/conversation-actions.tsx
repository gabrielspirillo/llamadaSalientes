'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import {
  closeConversation,
  deleteConversation,
  takeoverConversation,
  toggleUrgent,
} from '../actions';

interface Props {
  conversationId: string;
  status: 'ACTIVE' | 'HANDOFF' | 'CLOSED';
  urgentFlag: boolean;
}

export function ConversationActions({ conversationId, status, urgentFlag }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<unknown>) => () => startTransition(async () => void (await fn()));

  const onDelete = () =>
    startTransition(async () => {
      if (
        !window.confirm('¿Eliminar esta conversación y todos sus mensajes? No se puede deshacer.')
      )
        return;
      const res = (await deleteConversation({ conversationId })) as {
        success: boolean;
        error?: string;
      };
      if (!res?.success) {
        window.alert(res?.error ?? 'No se pudo eliminar la conversación.');
        return;
      }
      router.push('/dashboard/whatsapp');
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run(() => toggleUrgent({ conversationId }))}
        disabled={pending}
        className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-300 hover:-translate-y-0.5 active:scale-95 ${
          urgentFlag
            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
            : 'border-(--color-border) bg-white text-zinc-700 hover:border-brand-200 hover:text-brand-700'
        } disabled:opacity-50`}
      >
        {urgentFlag ? 'Quitar urgente' : 'Marcar urgente'}
      </button>

      {status !== 'HANDOFF' && status !== 'CLOSED' && (
        <button
          type="button"
          onClick={run(() => takeoverConversation({ conversationId, hours: 2 }))}
          disabled={pending}
          className="rounded-full bg-[linear-gradient(120deg,#d97706,#fbbf24)] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(245,158,11,0.8)] transition-all duration-300 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50"
        >
          Atender yo (2 h)
        </button>
      )}

      {status !== 'CLOSED' && (
        <button
          type="button"
          onClick={run(() => closeConversation({ conversationId }))}
          disabled={pending}
          className="rounded-full border border-rose-200 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-rose-700 transition-all duration-300 hover:-translate-y-0.5 hover:bg-rose-50 active:scale-95 disabled:opacity-50"
        >
          Cerrar
        </button>
      )}

      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-full border border-rose-300 bg-rose-600 px-3.5 py-1.5 text-[13px] font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-rose-700 active:scale-95 disabled:opacity-50"
      >
        Eliminar
      </button>
    </div>
  );
}
