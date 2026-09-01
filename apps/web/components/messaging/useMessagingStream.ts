'use client';

import type { ImRealtimeEvent, ImRealtimeEventKind } from '@/lib/messaging/events';
import { useEffect, useRef, useState } from 'react';

/* ============================================================================
   Un solo EventSource por sesión contra /api/messages/stream.

   El servidor multiplexa TODOS los canales del usuario sobre esa conexión: el
   nombre del evento SSE es el `kind` del payload y el JSON entero va como
   `data`. Acá lo único que hacemos es despachar a los callbacks tipados.

   EventSource reconecta solo, así que el handler de `error` NO cierra nada: se
   limita a marcar que hubo un corte para que, cuando vuelva el `open`,
   disparemos `onReconnect` y el workspace resincronice el rail (mientras
   estuvimos caídos nos perdimos eventos y no hay backlog).
   ========================================================================== */

type EventOf<K extends ImRealtimeEventKind> = Extract<ImRealtimeEvent, { kind: K }>;

export interface MessagingStreamHandlers {
  onMessageNew?: (e: EventOf<'message.new'>) => void;
  onMessageUpdated?: (e: EventOf<'message.updated'>) => void;
  onMessageDeleted?: (e: EventOf<'message.deleted'>) => void;
  onReactionChanged?: (e: EventOf<'reaction.changed'>) => void;
  onChannelUpdated?: (e: EventOf<'channel.updated'>) => void;
  onMemberJoined?: (e: EventOf<'channel.member_joined'>) => void;
  onMemberLeft?: (e: EventOf<'channel.member_left'>) => void;
  onTypingStart?: (e: EventOf<'typing.start'>) => void;
  onTypingStop?: (e: EventOf<'typing.stop'>) => void;
  onPresenceChanged?: (e: EventOf<'presence.changed'>) => void;
  onUnreadChanged?: (e: EventOf<'unread.changed'>) => void;
  onMentionNew?: (e: EventOf<'mention.new'>) => void;
  /** Se llama tras recuperar la conexión: hay que resincronizar con GET /rail. */
  onReconnect?: () => void;
}

export interface MessagingStreamState {
  /** true mientras la conexión SSE está viva. */
  connected: boolean;
}

export function useMessagingStream(handlers: MessagingStreamHandlers): MessagingStreamState {
  // Los handlers cambian en cada render del workspace; el EventSource se monta
  // una sola vez y lee siempre la última versión desde el ref.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const es = new EventSource('/api/messages/stream');
    let hadError = false;

    const bind = <K extends ImRealtimeEventKind>(
      kind: K,
      pick: (h: MessagingStreamHandlers) => ((e: EventOf<K>) => void) | undefined,
    ) => {
      es.addEventListener(kind, (raw: Event) => {
        const ev = raw as MessageEvent<string>;
        try {
          const payload = JSON.parse(ev.data) as ImRealtimeEvent;
          if (payload.kind !== kind) return;
          pick(handlersRef.current)?.(payload as EventOf<K>);
        } catch {
          /* payload inválido — ignorar, no vale tirar el stream por esto */
        }
      });
    };

    bind('message.new', (h) => h.onMessageNew);
    bind('message.updated', (h) => h.onMessageUpdated);
    bind('message.deleted', (h) => h.onMessageDeleted);
    bind('reaction.changed', (h) => h.onReactionChanged);
    bind('channel.updated', (h) => h.onChannelUpdated);
    bind('channel.member_joined', (h) => h.onMemberJoined);
    bind('channel.member_left', (h) => h.onMemberLeft);
    bind('typing.start', (h) => h.onTypingStart);
    bind('typing.stop', (h) => h.onTypingStop);
    bind('presence.changed', (h) => h.onPresenceChanged);
    bind('unread.changed', (h) => h.onUnreadChanged);
    bind('mention.new', (h) => h.onMentionNew);

    es.addEventListener('open', () => {
      setConnected(true);
      if (hadError) {
        hadError = false;
        handlersRef.current.onReconnect?.();
      }
    });

    es.addEventListener('error', () => {
      // No cerramos: EventSource reintenta solo con backoff del navegador.
      hadError = true;
      setConnected(false);
    });

    return () => {
      es.close();
    };
  }, []);

  return { connected };
}
