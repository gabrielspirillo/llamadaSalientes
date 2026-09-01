'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { EmptyState, SkeletonRows } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { ImMessageDTO, ImThreadPage } from '@/lib/messaging/types';
import { MessageSquare, SendHorizontal } from 'lucide-react';

/* ============================================================================
   Hilo compacto del dock. Es la versión reducida del hilo de la página
   completa: sin reacciones, sin respuestas anidadas, sin adjuntos. Solo leer y
   contestar rápido sin abandonar la pantalla en la que estás.
   ========================================================================== */

const DOCK_PAGE_SIZE = 30;

function sortAndDedupe(list: ImMessageDTO[]): ImMessageDTO[] {
  const byKey = new Map<string, ImMessageDTO>();
  for (const m of list) {
    // Un mensaje confirmado pisa a su burbuja optimista (mismo clientNonce).
    if (m.clientNonce) {
      for (const [k, v] of byKey) {
        if (v.clientNonce && v.clientNonce === m.clientNonce && v.id !== m.id) byKey.delete(k);
      }
    }
    byKey.set(m.id, m);
  }
  return Array.from(byKey.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function hourOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function DockThread({ channelId }: { channelId: string }) {
  const { sendMessage, markRead, subscribe, typingIn, rail } = useMessaging();

  const [messages, setMessages] = useState<ImMessageDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const meId = rail?.me?.userId ?? null;

  /* --- Carga inicial ---------------------------------------------------- */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/messages/channels/${channelId}/messages?limit=${DOCK_PAGE_SIZE}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        setMessages([]);
        return;
      }
      // La ruta puede devolver el ImThreadPage plano o envuelto en `page`.
      const data = (await res.json()) as ImThreadPage & { page?: ImThreadPage };
      const page = data.page ?? data;
      setMessages(sortAndDedupe(page?.messages ?? []));
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    setMessages([]);
    stickRef.current = true;
    void load();
  }, [load]);

  /* --- Marcar leído al abrir el canal ----------------------------------- */
  // Solo al cambiar de canal o al terminar la carga: no en cada mensaje.
  // biome-ignore lint/correctness/useExhaustiveDependencies: acotado a propósito
  useEffect(() => {
    if (loading) return;
    const last = messages[messages.length - 1];
    void markRead(channelId, last?.id ?? null);
  }, [channelId, loading]);

  /* --- Eventos en vivo --------------------------------------------------- */
  useEffect(() => {
    const offNew = subscribe('message.new', (event) => {
      if (event.kind !== 'message.new' || event.channelId !== channelId) return;
      setMessages((prev) => sortAndDedupe([...prev, event.message]));
      void markRead(channelId, event.message.id);
    });
    const offUpd = subscribe('message.updated', (event) => {
      if (event.kind !== 'message.updated' || event.channelId !== channelId) return;
      setMessages((prev) =>
        sortAndDedupe(prev.map((m) => (m.id === event.message.id ? event.message : m))),
      );
    });
    const offDel = subscribe('message.deleted', (event) => {
      if (event.kind !== 'message.deleted' || event.channelId !== channelId) return;
      setMessages((prev) => prev.filter((m) => m.id !== event.messageId));
    });
    return () => {
      offNew();
      offUpd();
      offDel();
    };
  }, [channelId, subscribe, markRead]);

  /* --- Autoscroll pegado al fondo --------------------------------------- */
  // biome-ignore lint/correctness/useExhaustiveDependencies: depende de la lista, no de las refs
  useLayoutEffect(() => {
    if (stickRef.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  /* --- Envío optimista --------------------------------------------------- */
  async function onSend() {
    const body = draft.trim();
    if (!body || sending) return;

    const clientNonce = `dock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ImMessageDTO = {
      id: clientNonce,
      channelId,
      kind: 'TEXT',
      senderKind: 'USER',
      senderUserId: meId,
      senderName: rail?.me?.name ?? 'Vos',
      senderInitials: rail?.me?.initials ?? null,
      body,
      parentId: null,
      replyCount: 0,
      contextType: null,
      contextId: null,
      contextPayload: {},
      attachments: [],
      actions: [],
      eventKey: null,
      mentions: [],
      mentionsEveryone: false,
      reactions: [],
      pinned: false,
      saved: false,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      clientNonce,
      pending: true,
    };

    setDraft('');
    setSending(true);
    stickRef.current = true;
    setMessages((prev) => sortAndDedupe([...prev, optimistic]));

    const saved = await sendMessage(channelId, body, { clientNonce });
    if (saved) {
      setMessages((prev) =>
        sortAndDedupe([...prev.filter((m) => m.id !== clientNonce), { ...saved, clientNonce }]),
      );
    } else {
      // Sin confirmación: recargamos la última página. Si tampoco aparece,
      // la burbuja queda marcada como fallida.
      await load();
      setMessages((prev) =>
        prev.some((m) => m.body === body && !m.pending)
          ? prev
          : sortAndDedupe([
              ...prev.filter((m) => m.id !== clientNonce),
              { ...optimistic, pending: false, failed: true },
            ]),
      );
    }
    setSending(false);
  }

  const peers = typingIn(channelId).filter((p) => p.userId !== meId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* --- Mensajes ------------------------------------------------------ */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-none min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
      >
        {loading ? (
          <SkeletonRows rows={4} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title="Todavía no hay nada"
            description="Escribí el primer mensaje del canal."
          />
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const mine = !!meId && m.senderUserId === meId;
            const grouped =
              !!prev && prev.senderUserId === m.senderUserId && prev.senderKind === m.senderKind;
            const isSystem = m.senderKind !== 'USER';

            return (
              <div
                key={m.id}
                className={cn(
                  'flex animate-fade-up items-end gap-2',
                  mine && 'flex-row-reverse',
                  grouped ? 'mt-0.5' : 'mt-2.5',
                )}
              >
                <span className="w-6 shrink-0">
                  {!grouped && !mine && <Avatar name={m.senderName ?? 'Sistema'} size={24} />}
                </span>
                <div className={cn('min-w-0 max-w-[78%]', mine && 'text-right')}>
                  {!grouped && !mine && (
                    <p className="mb-0.5 truncate text-[12px] font-semibold text-zinc-500">
                      {m.senderName ?? 'Sistema'}
                    </p>
                  )}
                  <div
                    className={cn(
                      'inline-block rounded-[16px] px-3 py-2 text-left text-[14px] leading-snug transition-opacity duration-200',
                      mine
                        ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white'
                        : isSystem
                          ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-100'
                          : 'bg-white text-zinc-800 ring-1 ring-[--color-border]',
                      m.pending && 'opacity-60',
                      m.failed && 'ring-1 ring-rose-300',
                    )}
                  >
                    <span className="whitespace-pre-wrap break-words">{m.body}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
                    {m.failed ? 'No se pudo enviar' : hourOf(m.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}

        {peers.length > 0 && (
          <p className="px-1 text-[12px] italic text-zinc-500">
            {peers.length === 1
              ? `${peers[0]?.name} está escribiendo…`
              : `${peers.length} personas están escribiendo…`}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* --- Composer ------------------------------------------------------ */}
      <div className="flex shrink-0 items-center gap-2 border-t border-white/60 bg-white/70 px-3 py-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
            // Escape lo maneja el dock: acá solo evitamos que se propague si
            // hay texto a medias.
            if (e.key === 'Escape' && draft.length > 0) {
              e.stopPropagation();
              setDraft('');
            }
          }}
          placeholder="Escribí un mensaje…"
          aria-label="Mensaje"
          className="h-10 min-w-0 flex-1 rounded-full border border-[--color-border] bg-white px-4 text-[14px] outline-none transition-colors placeholder:text-zinc-400 focus:border-brand-300"
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={!draft.trim() || sending}
          aria-label="Enviar"
          className="sheen press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_8px_20px_-10px_rgba(55,118,106,0.9)] transition-all disabled:pointer-events-none disabled:opacity-40"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
