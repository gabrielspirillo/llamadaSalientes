'use client';

import { useTransition } from 'react';

import {
  closeConversation,
  releaseConversation,
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

  const run = (fn: () => Promise<unknown>) => () => startTransition(async () => void (await fn()));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run(() => toggleUrgent({ conversationId }))}
        disabled={pending}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          urgentFlag
            ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
            : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
        } disabled:opacity-50`}
      >
        {urgentFlag ? 'Quitar urgente' : 'Marcar urgente'}
      </button>

      {status !== 'HANDOFF' && status !== 'CLOSED' && (
        <button
          type="button"
          onClick={run(() => takeoverConversation({ conversationId, hours: 2 }))}
          disabled={pending}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Tomar conversación (2 h)
        </button>
      )}

      {status === 'HANDOFF' && (
        <button
          type="button"
          onClick={run(() => releaseConversation({ conversationId }))}
          disabled={pending}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          Liberar al bot
        </button>
      )}

      {status !== 'CLOSED' && (
        <button
          type="button"
          onClick={run(() => closeConversation({ conversationId }))}
          disabled={pending}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Cerrar
        </button>
      )}
    </div>
  );
}
