'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { SerializedWhatsappMessage } from '@/lib/whatsapp/realtime/events';

// Render del thread de mensajes con suscripción SSE para refrescar en vivo.
// La página servidor pasa la lista inicial; acá montamos un EventSource a
// /api/whatsapp/conversations/[id]/stream que emite:
//   - event: message     → nuevo mensaje insertado en BD
//   - event: typing.start / typing.stop → estado del agente IA
//
// EventSource maneja la reconexión automática. Si se cae Redis o el server,
// reabre la conexión solo. Si querés un fallback agresivo, agregale un
// fetch periódico de "mensajes posteriores a X" — por ahora no hace falta.

interface InitialMessage {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  senderType: string;
  senderUserId: string | null;
  internalNote: boolean;
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  deliveryStatus: string | null;
  // Serializado a ISO string desde el page.tsx server component (Date no
  // viaja por el límite server→client).
  createdAt: string;
}

interface Props {
  conversationId: string;
  initialMessages: InitialMessage[];
  /** Map de senderUserId → email para mostrar el autor en mensajes outbound humanos. */
  senderUserEmails: Record<string, string>;
}

type Message = InitialMessage;

function dedupeAndSort(messages: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of messages) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export function MessagesStream({
  conversationId,
  initialMessages,
  senderUserEmails,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(() =>
    dedupeAndSort(initialMessages),
  );
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  // Sólo auto-scrollear si el usuario ya estaba pegado al fondo. Si scrolleó
  // arriba para leer historial, no se lo movemos cuando llega un mensaje.
  const stickToBottomRef = useRef(true);

  useLayoutEffect(() => {
    if (stickToBottomRef.current) {
      bottomAnchorRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages, isAgentTyping]);

  function onScroll() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  useEffect(() => {
    const url = `/api/whatsapp/conversations/${conversationId}/stream`;
    const es = new EventSource(url);

    es.addEventListener('message', (e: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(e.data) as {
          kind: 'message';
          message: SerializedWhatsappMessage;
        };
        if (payload.kind !== 'message') return;
        const incoming = payload.message;
        setMessages((prev) => {
          // Dedupe por id; si ya está, ignoramos (puede pasar si la página
          // hizo el revalidatePath y luego SSE entregó el mismo row).
          if (prev.some((m) => m.id === incoming.id)) return prev;
          return [...prev, incoming];
        });
        // Si llegó un OUTBOUND del agente, paramos el typing por las dudas
        // (el server emite typing.stop en finally, pero adelantamos UX).
        if (incoming.direction === 'OUTBOUND' && incoming.senderType === 'AGENT') {
          setIsAgentTyping(false);
        }
      } catch {
        /* payload inválido — ignorar */
      }
    });

    es.addEventListener('typing.start', () => setIsAgentTyping(true));
    es.addEventListener('typing.stop', () => setIsAgentTyping(false));

    es.addEventListener('error', () => {
      // EventSource reintenta solo; no cerramos manualmente para permitir
      // recuperación automática.
    });

    return () => {
      es.close();
    };
  }, [conversationId]);

  const empty = messages.length === 0 && !isAgentTyping;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto bg-zinc-50 p-4"
    >
      {empty ? (
        <p className="text-center text-sm text-zinc-500">Sin mensajes aún.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} senderUserEmails={senderUserEmails} />
          ))}
          {isAgentTyping && <TypingBubble />}
        </ul>
      )}
      <div ref={bottomAnchorRef} />
    </div>
  );
}

function MessageBubble({
  message: m,
  senderUserEmails,
}: {
  message: Message;
  senderUserEmails: Record<string, string>;
}) {
  const isOutbound = m.direction === 'OUTBOUND';
  const isInternal = m.internalNote;
  const containerCls = isInternal
    ? 'mx-auto bg-amber-50 border border-amber-200'
    : isOutbound
      ? 'ml-auto bg-emerald-500 text-white'
      : 'mr-auto bg-white border border-zinc-200';
  const authorEmail = m.senderUserId ? senderUserEmails[m.senderUserId] ?? null : null;
  const timestamp = useMemo(() => new Date(m.createdAt).toLocaleString(), [m.createdAt]);

  return (
    <li className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 text-sm ${containerCls}`}>
      {isInternal && (
        <div className="mb-1 text-[10px] font-semibold uppercase text-amber-700">
          Nota interna{authorEmail ? ` · ${authorEmail}` : ''}
        </div>
      )}
      {!isInternal && isOutbound && authorEmail && (
        <div className="mb-0.5 text-[10px] font-medium text-emerald-100">{authorEmail}</div>
      )}
      {m.mediaUrl && m.type === 'IMAGE' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.mediaUrl} alt="adjunto" className="mb-1 max-h-72 rounded-lg" />
      )}
      {m.mediaUrl && m.type === 'AUDIO' && (
        <audio src={m.mediaUrl} controls className="mb-1 w-full" />
      )}
      {m.mediaUrl && m.type === 'VIDEO' && (
        <video src={m.mediaUrl} controls className="mb-1 max-h-72 rounded-lg" />
      )}
      {m.mediaUrl && m.type === 'PDF' && (
        <a
          href={m.mediaUrl}
          target="_blank"
          rel="noreferrer"
          className={`mb-1 inline-flex items-center gap-1 underline ${
            isOutbound ? 'text-emerald-50' : 'text-emerald-700'
          }`}
        >
          📎 Ver documento
        </a>
      )}
      <div className="whitespace-pre-wrap">
        {m.contentText ?? (m.mediaUrl ? '' : `[${m.type}]`)}
      </div>
      <div
        className={`mt-1 flex items-center gap-2 text-[10px] ${
          isOutbound && !isInternal ? 'text-emerald-100' : 'text-zinc-500'
        }`}
      >
        <span>{timestamp}</span>
        {isOutbound && m.deliveryStatus && (
          <span className="uppercase">{m.deliveryStatus}</span>
        )}
      </div>
    </li>
  );
}

function TypingBubble() {
  return (
    <li className="mr-auto max-w-[60%] rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm">
      <div className="flex items-center gap-2 text-zinc-500">
        <span className="text-[11px]">Agente escribiendo</span>
        <span className="inline-flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
        </span>
      </div>
    </li>
  );
}
