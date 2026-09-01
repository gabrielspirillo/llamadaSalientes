'use client';

import { ChannelRail } from '@/components/messaging/ChannelRail';
import { Composer } from '@/components/messaging/Composer';
import { ContextPanel } from '@/components/messaging/ContextPanel';
import { MessageThread } from '@/components/messaging/MessageThread';
import { ThreadPanel } from '@/components/messaging/ThreadPanel';
import {
  buildMentionIndex,
  initialsOf,
  mentionedUserIds,
  peopleMap,
  presenceMap,
} from '@/components/messaging/shared';
import { useMessagingStream } from '@/components/messaging/useMessagingStream';
import { Callout } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { THREAD_PAGE_SIZE, TYPING_TTL_SECONDS } from '@/lib/messaging/constants';
import type {
  ImAction,
  ImAttachment,
  ImChannelDTO,
  ImMessageDTO,
  ImPresence,
  ImRailDTO,
} from '@/lib/messaging/types';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ============================================================================
   Orquestador del módulo Mensajes.

   Tiene tres responsabilidades y ninguna más:
   1. Mantener el rail (canales, personas, presencia, contadores) al día.
   2. Cachear la página cargada de cada canal y paginar hacia atrás.
   3. Enviar de forma optimista y reconciliar con lo que confirme el servidor
      —por el POST o por el SSE, lo que llegue primero.
   ========================================================================== */

interface ThreadState {
  messages: ImMessageDTO[];
  pins: ImMessageDTO[];
  cursor: string | null;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** Dónde va el divisor rojo "Mensajes nuevos". */
  firstUnreadId: string | null;
}

interface TypingEntry {
  name: string;
  expiresAt: number;
}

const EMPTY_THREAD: ThreadState = {
  messages: [],
  pins: [],
  cursor: null,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
  firstUnreadId: null,
};

function newNonce(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `n-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sortMessages(list: ImMessageDTO[]): ImMessageDTO[] {
  return [...list].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Inserta o reconcilia un mensaje real contra la lista.
 *
 * El DTO del servidor no viaja con `clientNonce`, así que el optimista se
 * reconoce por nonce (cuando responde el POST) o, si el SSE llegó antes, por
 * "mismo autor y mismo cuerpo". Sin esto se ve el mensaje duplicado durante un
 * instante, que es exactamente lo que rompe la sensación de inmediatez.
 */
function mergeMessage(
  list: ImMessageDTO[],
  incoming: ImMessageDTO,
  nonce?: string | null,
): ImMessageDTO[] {
  const byId = list.findIndex((m) => m.id === incoming.id);
  if (byId >= 0) {
    const next = [...list];
    next[byId] = { ...incoming };
    return next;
  }

  const optimistic = list.findIndex(
    (m) =>
      m.pending === true &&
      ((nonce && m.clientNonce === nonce) ||
        (m.senderUserId === incoming.senderUserId &&
          m.body === incoming.body &&
          m.parentId === incoming.parentId)),
  );
  if (optimistic >= 0) {
    const next = [...list];
    next[optimistic] = { ...incoming };
    return next;
  }

  return sortMessages([...list, incoming]);
}

export function MessagesWorkspace({
  initialRail,
  currentUserId,
  canWrite,
}: {
  initialRail: ImRailDTO;
  currentUserId: string | null;
  canWrite: boolean;
}) {
  const [rail, setRail] = useState<ImRailDTO>(initialRail);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});
  const [activeId, setActiveId] = useState<string | null>(
    () => initialRail.channels.find((c) => !c.archived)?.id ?? null,
  );
  const [typing, setTyping] = useState<Record<string, Record<string, TypingEntry>>>({});
  const [mobilePane, setMobilePane] = useState<'rail' | 'thread' | 'context'>('thread');
  const [contextOpen, setContextOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);

  const [threadParent, setThreadParent] = useState<ImMessageDTO | null>(null);
  const [replies, setReplies] = useState<ImMessageDTO[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const threadParentRef = useRef(threadParent);
  threadParentRef.current = threadParent;

  const mentions = useMemo(() => buildMentionIndex(rail.people), [rail.people]);
  const presence = useMemo(() => presenceMap(rail.presence), [rail.presence]);
  const persons = useMemo(() => peopleMap(rail.people), [rail.people]);

  const activeChannel = useMemo<ImChannelDTO | null>(
    () => rail.channels.find((c) => c.id === activeId) ?? null,
    [rail.channels, activeId],
  );
  const thread = threads[activeId ?? ''] ?? EMPTY_THREAD;

  // ── Rail ──────────────────────────────────────────────────────────────────

  const refreshRail = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/rail', { cache: 'no-store' });
      const data = (await res.json()) as { rail?: ImRailDTO; error?: string };
      if (!res.ok || !data.rail) throw new Error(data.error ?? 'No se pudo cargar el rail');
      setRail(data.rail);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const patchChannel = useCallback((channelId: string, patch: Partial<ImChannelDTO>) => {
    setRail((prev) => ({
      ...prev,
      channels: prev.channels.map((c) => (c.id === channelId ? { ...c, ...patch } : c)),
    }));
  }, []);

  // ── Carga del hilo ────────────────────────────────────────────────────────

  const markRead = useCallback(
    async (channelId: string, upToMessageId?: string | null) => {
      patchChannel(channelId, { unreadCount: 0, mentionCount: 0 });
      try {
        await fetch(`/api/messages/channels/${channelId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upToMessageId: upToMessageId ?? null }),
        });
      } catch {
        /* leer es best-effort: si falla, el SSE o el próximo rail lo corrigen */
      }
    },
    [patchChannel],
  );

  const loadThread = useCallback(
    async (channelId: string, before?: string | null) => {
      setThreads((prev) => {
        const cur = prev[channelId] ?? EMPTY_THREAD;
        return {
          ...prev,
          [channelId]: { ...cur, loading: !before && !cur.loaded, loadingMore: !!before },
        };
      });

      try {
        const params = new URLSearchParams({ limit: String(THREAD_PAGE_SIZE) });
        if (before) params.set('before', before);
        const res = await fetch(`/api/messages/channels/${channelId}/messages?${params}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as {
          page?: { messages: ImMessageDTO[]; nextCursor: string | null; hasMore: boolean };
          messages?: ImMessageDTO[];
          nextCursor?: string | null;
          hasMore?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar la conversación');

        const page = data.page ?? {
          messages: data.messages ?? [],
          nextCursor: data.nextCursor ?? null,
          hasMore: data.hasMore ?? false,
        };
        const incoming = sortMessages(page.messages ?? []);

        setThreads((prev) => {
          const cur = prev[channelId] ?? EMPTY_THREAD;
          if (before) {
            const known = new Set(cur.messages.map((m) => m.id));
            const merged = sortMessages([
              ...incoming.filter((m) => !known.has(m.id)),
              ...cur.messages,
            ]);
            return {
              ...prev,
              [channelId]: {
                ...cur,
                messages: merged,
                cursor: page.nextCursor ?? null,
                hasMore: !!page.hasMore,
                loadingMore: false,
                loaded: true,
              },
            };
          }

          // Primera carga: se conservan los optimistas todavía en vuelo.
          const pending = cur.messages.filter((m) => m.pending || m.failed);
          const unread = rail.channels.find((c) => c.id === channelId)?.unreadCount ?? 0;
          const firstUnreadId =
            unread > 0 && unread <= incoming.length
              ? (incoming[incoming.length - unread]?.id ?? null)
              : null;

          return {
            ...prev,
            [channelId]: {
              ...cur,
              messages: sortMessages([...incoming, ...pending]),
              cursor: page.nextCursor ?? null,
              hasMore: !!page.hasMore,
              loading: false,
              loadingMore: false,
              loaded: true,
              firstUnreadId,
            },
          };
        });

        const last = incoming.at(-1);
        void markRead(channelId, last?.id ?? null);
      } catch (err) {
        setError((err as Error).message);
        setThreads((prev) => {
          const cur = prev[channelId] ?? EMPTY_THREAD;
          return { ...prev, [channelId]: { ...cur, loading: false, loadingMore: false } };
        });
      }
    },
    [markRead, rail.channels],
  );

  const loadPins = useCallback(async (channelId: string) => {
    try {
      const res = await fetch(`/api/messages/channels/${channelId}/pins`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { pins?: ImMessageDTO[]; messages?: ImMessageDTO[] };
      const pins = data.pins ?? data.messages ?? [];
      setThreads((prev) => {
        const cur = prev[channelId] ?? EMPTY_THREAD;
        return { ...prev, [channelId]: { ...cur, pins } };
      });
    } catch {
      /* los fijados son decorativos: si fallan, el panel simplemente no los muestra */
    }
  }, []);

  const openChannel = useCallback(
    (channelId: string) => {
      setActiveId(channelId);
      setMobilePane('thread');
      setThreadParent(null);
      const known = threads[channelId];
      if (!known?.loaded) {
        void loadThread(channelId);
        void loadPins(channelId);
      } else {
        void markRead(channelId, known.messages.at(-1)?.id ?? null);
      }
    },
    [threads, loadThread, loadPins, markRead],
  );

  // Primera hidratación del canal activo.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current || !activeId) return;
    bootedRef.current = true;
    void loadThread(activeId);
    void loadPins(activeId);
  }, [activeId, loadThread, loadPins]);

  // ── Escritura ─────────────────────────────────────────────────────────────

  const upsertInThread = useCallback(
    (channelId: string, updater: (list: ImMessageDTO[]) => ImMessageDTO[]) => {
      setThreads((prev) => {
        const cur = prev[channelId] ?? EMPTY_THREAD;
        return { ...prev, [channelId]: { ...cur, messages: updater(cur.messages) } };
      });
    },
    [],
  );

  const postMessage = useCallback(
    async (channelId: string, optimistic: ImMessageDTO) => {
      const nonce = optimistic.clientNonce ?? null;
      try {
        const res = await fetch(`/api/messages/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: optimistic.body,
            clientNonce: nonce,
            parentId: optimistic.parentId,
            attachments: optimistic.attachments,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          message?: ImMessageDTO;
          id?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'No se pudo enviar');

        const confirm = (list: ImMessageDTO[]) => {
          if (data.message) return mergeMessage(list, data.message, nonce);
          return list.map((m) =>
            m.clientNonce === nonce
              ? { ...m, id: data.id ?? m.id, pending: false, failed: false }
              : m,
          );
        };

        if (optimistic.parentId) {
          setReplies((prev) => confirm(prev));
          upsertInThread(channelId, (list) =>
            list.map((m) =>
              m.id === optimistic.parentId ? { ...m, replyCount: m.replyCount + 1 } : m,
            ),
          );
        } else {
          upsertInThread(channelId, confirm);
        }
      } catch (err) {
        const fail = (list: ImMessageDTO[]) =>
          list.map((m) => (m.clientNonce === nonce ? { ...m, pending: false, failed: true } : m));
        if (optimistic.parentId) setReplies((prev) => fail(prev));
        else upsertInThread(channelId, fail);
        setError((err as Error).message);
      }
    },
    [upsertInThread],
  );

  const send = useCallback(
    (channelId: string, body: string, attachments: ImAttachment[], parentId: string | null) => {
      const me = rail.me;
      const nonce = newNonce();
      const optimistic: ImMessageDTO = {
        id: `tmp-${nonce}`,
        channelId,
        kind: 'TEXT',
        senderKind: 'USER',
        senderUserId: currentUserId,
        senderName: me?.name ?? 'Vos',
        senderInitials: me?.initials ?? initialsOf(me?.name ?? 'Vos'),
        body,
        parentId,
        replyCount: 0,
        contextType: null,
        contextId: null,
        contextPayload: {},
        attachments,
        actions: [],
        eventKey: null,
        mentions: mentionedUserIds(body, mentions),
        mentionsEveryone: /(^|\s)@(todos|canal|aqui|aquí)\b/i.test(body),
        reactions: [],
        pinned: false,
        saved: false,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        clientNonce: nonce,
        pending: true,
      };

      if (parentId) {
        setReplies((prev) => sortMessages([...prev, optimistic]));
      } else {
        upsertInThread(channelId, (list) => sortMessages([...list, optimistic]));
      }
      void postMessage(channelId, optimistic);
    },
    [rail.me, currentUserId, mentions, upsertInThread, postMessage],
  );

  const retry = useCallback(
    (message: ImMessageDTO) => {
      const channelId = message.channelId;
      const clean = (list: ImMessageDTO[]) => list.filter((m) => m.id !== message.id);
      if (message.parentId) setReplies((prev) => clean(prev));
      else upsertInThread(channelId, clean);
      send(channelId, message.body, message.attachments, message.parentId);
    },
    [send, upsertInThread],
  );

  const sendTyping = useCallback((channelId: string) => {
    void fetch(`/api/messages/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {
      /* el aviso de escritura nunca puede romper el envío */
    });
  }, []);

  // ── Acciones sobre un mensaje ─────────────────────────────────────────────

  const patchMessage = useCallback((messageId: string, patch: Partial<ImMessageDTO>) => {
    setThreads((prev) => {
      const next: Record<string, ThreadState> = {};
      for (const [cid, st] of Object.entries(prev)) {
        next[cid] = {
          ...st,
          messages: st.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
          pins: st.pins.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
        };
      }
      return next;
    });
    setReplies((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
    setThreadParent((prev) => (prev && prev.id === messageId ? { ...prev, ...patch } : prev));
  }, []);

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      if (!currentUserId) return;
      // Optimista: la píldora entra con animate-pop antes de que responda nadie.
      setThreads((prev) => {
        const next: Record<string, ThreadState> = {};
        for (const [cid, st] of Object.entries(prev)) {
          next[cid] = {
            ...st,
            messages: st.messages.map((m) =>
              m.id === messageId ? { ...m, reactions: flipReaction(m, emoji, currentUserId) } : m,
            ),
          };
        }
        return next;
      });
      setReplies((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, reactions: flipReaction(m, emoji, currentUserId) } : m,
        ),
      );

      void fetch(`/api/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      }).catch(() => {
        /* el evento reaction.changed es la fuente de verdad */
      });
    },
    [currentUserId],
  );

  const editMessage = useCallback(
    (message: ImMessageDTO, body: string) => {
      patchMessage(message.id, { body, editedAt: new Date().toISOString() });
      void fetch(`/api/messages/${message.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }).catch(() => setError('No se pudo editar el mensaje'));
    },
    [patchMessage],
  );

  const deleteMessage = useCallback(
    (message: ImMessageDTO) => {
      patchMessage(message.id, { deletedAt: new Date().toISOString() });
      void fetch(`/api/messages/${message.id}`, { method: 'DELETE' }).catch(() =>
        setError('No se pudo eliminar el mensaje'),
      );
    },
    [patchMessage],
  );

  const togglePin = useCallback(
    (message: ImMessageDTO) => {
      const pinned = !message.pinned;
      patchMessage(message.id, { pinned });
      setThreads((prev) => {
        const st = prev[message.channelId];
        if (!st) return prev;
        const pins = pinned
          ? [{ ...message, pinned: true }, ...st.pins.filter((p) => p.id !== message.id)]
          : st.pins.filter((p) => p.id !== message.id);
        return { ...prev, [message.channelId]: { ...st, pins } };
      });
      void fetch(`/api/messages/${message.id}/pin`, { method: 'POST' }).catch(() =>
        setError('No se pudo fijar el mensaje'),
      );
    },
    [patchMessage],
  );

  const toggleSave = useCallback(
    (message: ImMessageDTO) => {
      patchMessage(message.id, { saved: !message.saved });
      void fetch(`/api/messages/${message.id}/save`, { method: 'POST' }).catch(() =>
        setError('No se pudo guardar el mensaje'),
      );
    },
    [patchMessage],
  );

  const runAction = useCallback(
    async (action: ImAction, message: ImMessageDTO) => {
      if (!action.action) return;
      const res = await fetch(action.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(action.payload ?? {}), messageId: message.id }),
      });
      if (!res.ok) throw new Error('La acción no se pudo completar');
      void refreshRail();
    },
    [refreshRail],
  );

  // ── Hilo de respuestas ────────────────────────────────────────────────────

  const openThread = useCallback(async (message: ImMessageDTO) => {
    setThreadParent(message);
    setReplies([]);
    setRepliesLoading(true);
    try {
      const res = await fetch(
        `/api/messages/channels/${message.channelId}/messages?parentId=${message.id}&limit=100`,
        { cache: 'no-store' },
      );
      const data = (await res.json().catch(() => ({}))) as {
        page?: { messages: ImMessageDTO[] };
        messages?: ImMessageDTO[];
        replies?: ImMessageDTO[];
      };
      const list = data.replies ?? data.page?.messages ?? data.messages ?? [];
      setReplies(sortMessages(list.filter((m) => m.id !== message.id)));
    } catch {
      setReplies([]);
    } finally {
      setRepliesLoading(false);
    }
  }, []);

  // ── DM ────────────────────────────────────────────────────────────────────

  const startDm = useCallback(
    async (userId: string) => {
      try {
        const res = await fetch('/api/messages/channels/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = (await res.json()) as {
          channel?: ImChannelDTO;
          id?: string;
          channelId?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'No se pudo abrir el directo');
        const id = data.channel?.id ?? data.id ?? data.channelId ?? null;
        await refreshRail();
        if (id) openChannel(id);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [refreshRail, openChannel],
  );

  // ── Tiempo real ───────────────────────────────────────────────────────────

  const { connected } = useMessagingStream({
    onMessageNew: (e) => {
      const isReply = !!e.message.parentId;

      setThreads((prev) => {
        const cur = prev[e.channelId];
        // Canal que todavía no abrimos: no cacheamos nada, el rail ya avisa.
        if (!cur?.loaded) return prev;
        if (isReply) {
          return {
            ...prev,
            [e.channelId]: {
              ...cur,
              messages: cur.messages.map((m) =>
                m.id === e.message.parentId ? { ...m, replyCount: m.replyCount + 1 } : m,
              ),
            },
          };
        }
        return {
          ...prev,
          [e.channelId]: { ...cur, messages: mergeMessage(cur.messages, e.message) },
        };
      });

      if (isReply && threadParentRef.current?.id === e.message.parentId) {
        setReplies((prev) => mergeMessage(prev, e.message));
      }

      // El emisor deja de "estar escribiendo" en cuanto llega su mensaje.
      if (e.message.senderUserId) {
        setTyping((prev) => {
          const chan = prev[e.channelId];
          if (!chan || !e.message.senderUserId || !chan[e.message.senderUserId]) return prev;
          const next = { ...chan };
          delete next[e.message.senderUserId];
          return { ...prev, [e.channelId]: next };
        });
      }

      setRail((prev) => ({
        ...prev,
        channels: prev.channels.map((c) =>
          c.id === e.channelId
            ? {
                ...c,
                lastMessageAt: e.message.createdAt,
                lastMessagePreview: e.message.body,
                messageCount: c.messageCount + 1,
              }
            : c,
        ),
      }));

      if (activeIdRef.current === e.channelId && !isReply) {
        void markRead(e.channelId, e.message.id);
      }
    },

    onMessageUpdated: (e) => {
      patchMessage(e.message.id, e.message);
    },

    onMessageDeleted: (e) => {
      patchMessage(e.messageId, { deletedAt: new Date().toISOString() });
    },

    onReactionChanged: (e) => {
      patchMessage(e.messageId, { reactions: e.reactions });
    },

    onChannelUpdated: () => {
      void refreshRail();
    },

    onMemberJoined: () => {
      void refreshRail();
    },

    onMemberLeft: () => {
      void refreshRail();
    },

    onTypingStart: (e) => {
      if (e.userId === currentUserId) return;
      setTyping((prev) => ({
        ...prev,
        [e.channelId]: {
          ...(prev[e.channelId] ?? {}),
          [e.userId]: {
            name: e.name || persons.get(e.userId)?.name || 'Alguien',
            expiresAt: Date.now() + TYPING_TTL_SECONDS * 1000,
          },
        },
      }));
    },

    onTypingStop: (e) => {
      setTyping((prev) => {
        const chan = prev[e.channelId];
        if (!chan?.[e.userId]) return prev;
        const next = { ...chan };
        delete next[e.userId];
        return { ...prev, [e.channelId]: next };
      });
    },

    onPresenceChanged: (e) => {
      setRail((prev) => {
        const rest = prev.presence.filter((p) => p.userId !== e.presence.userId);
        return { ...prev, presence: [...rest, e.presence] as ImPresence[] };
      });
    },

    onUnreadChanged: (e) => {
      setRail((prev) => ({
        ...prev,
        totalUnread: e.totalUnread,
        totalMentions: e.totalMentions,
        channels: prev.channels.map((c) =>
          c.id === e.channelId
            ? { ...c, unreadCount: e.unreadCount, mentionCount: e.mentionCount }
            : c,
        ),
      }));
    },

    onMentionNew: (e) => {
      setRail((prev) => ({
        ...prev,
        totalMentions: prev.totalMentions + 1,
        channels: prev.channels.map((c) =>
          c.id === e.channelId ? { ...c, mentionCount: c.mentionCount + 1 } : c,
        ),
      }));
    },

    // Volvimos de un corte: mientras estuvimos caídos no hay backlog, así que
    // se resincroniza el rail y se recarga el canal a la vista.
    onReconnect: () => {
      void refreshRail();
      const id = activeIdRef.current;
      if (id) void loadThread(id);
    },
  });

  // El "está escribiendo" caduca solo: sin esto, un stop perdido lo deja fijo.
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        let changed = false;
        const next: Record<string, Record<string, TypingEntry>> = {};
        for (const [cid, entries] of Object.entries(prev)) {
          const kept: Record<string, TypingEntry> = {};
          for (const [uid, entry] of Object.entries(entries)) {
            if (entry.expiresAt > now) kept[uid] = entry;
            else changed = true;
          }
          next[cid] = kept;
        }
        return changed ? next : prev;
      });
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // Título de pestaña: el truco más barato para que alguien vuelva.
  useEffect(() => {
    const base = 'Mensajes · FUTURA';
    document.title = rail.totalMentions > 0 ? `(${rail.totalMentions}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [rail.totalMentions]);

  const typingNames = useMemo(() => {
    const entries = typing[activeId ?? ''] ?? {};
    const now = Date.now();
    return Object.entries(entries)
      .filter(([uid, entry]) => uid !== currentUserId && entry.expiresAt > now)
      .map(([, entry]) => entry.name);
  }, [typing, activeId, currentUserId]);

  const jumpToMessage = useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.classList.add('animate-pop');
    setTimeout(() => el?.classList.remove('animate-pop'), 600);
  }, []);

  const toggleContext = useCallback(() => {
    const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches;
    if (wide) {
      setContextOpen((v) => !v);
    } else {
      setContextOpen(true);
      setMobilePane((p) => (p === 'context' ? 'thread' : 'context'));
    }
  }, []);

  return (
    <div className="flex h-[calc(100dvh-15rem)] min-h-[560px] flex-col gap-3">
      {error && (
        <Callout tone="danger" icon={<TriangleAlert className="h-4 w-4" />} className="shrink-0">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void refreshRail();
            }}
            className="font-semibold underline underline-offset-2"
          >
            Reintentar
          </button>
        </Callout>
      )}

      <div className="flex min-h-0 flex-1 gap-3 lg:gap-4">
        {/* Rail */}
        <ChannelRail
          channels={rail.channels}
          people={rail.people}
          presence={presence}
          me={rail.me}
          activeId={activeId}
          totalUnread={rail.totalUnread}
          connected={connected}
          onSelect={openChannel}
          onStartDm={startDm}
          className={cn(
            'w-full shrink-0 lg:flex lg:w-[286px]',
            mobilePane === 'rail' ? 'flex' : 'hidden',
          )}
        />

        {/* Hilo */}
        <MessageThread
          channel={activeChannel}
          messages={thread.messages}
          people={rail.people}
          presence={presence}
          mentions={mentions}
          currentUserId={currentUserId}
          loading={thread.loading}
          loadingMore={thread.loadingMore}
          hasMore={thread.hasMore}
          firstUnreadId={thread.firstUnreadId}
          typingNames={typingNames}
          connected={connected}
          contextOpen={contextOpen}
          onLoadMore={() => {
            if (activeId && thread.hasMore && !thread.loadingMore) {
              // Si el servidor no devolvió cursor, paginamos por el mensaje más
              // viejo que ya tenemos: nunca recargamos la misma primera página.
              void loadThread(activeId, thread.cursor ?? thread.messages[0]?.createdAt ?? null);
            }
          }}
          onToggleReaction={toggleReaction}
          onOpenThread={(m) => void openThread(m)}
          onEdit={editMessage}
          onDelete={deleteMessage}
          onTogglePin={togglePin}
          onToggleSave={toggleSave}
          onRetry={retry}
          onAction={runAction}
          onDropFiles={(files) => setDroppedFiles(files)}
          onBack={() => setMobilePane('rail')}
          onToggleContext={toggleContext}
          className={cn('min-w-0 flex-1', mobilePane === 'thread' ? 'flex' : 'hidden lg:flex')}
          composer={
            activeChannel ? (
              <Composer
                channelName={activeChannel.name}
                people={rail.people}
                mentions={mentions}
                currentUserId={currentUserId}
                disabled={!canWrite}
                placeholder={canWrite ? undefined : 'Tu rol solo permite leer este canal.'}
                resetKey={activeChannel.id}
                droppedFiles={droppedFiles}
                onDroppedHandled={() => setDroppedFiles(null)}
                onSend={(body, attachments) => send(activeChannel.id, body, attachments, null)}
                onTyping={() => sendTyping(activeChannel.id)}
              />
            ) : null
          }
        />

        {/* Contexto */}
        <ContextPanel
          channel={activeChannel}
          messages={thread.messages}
          pins={thread.pins}
          people={rail.people}
          presence={presence}
          currentUserId={currentUserId}
          mentions={mentions}
          onJumpToMessage={jumpToMessage}
          onTogglePin={togglePin}
          onClose={() => {
            setContextOpen(false);
            setMobilePane((p) => (p === 'context' ? 'thread' : p));
          }}
          className={cn(
            'w-full shrink-0 xl:w-[300px]',
            mobilePane === 'context' ? 'flex' : 'hidden',
            contextOpen ? 'xl:flex' : 'xl:hidden',
          )}
        />
      </div>

      {/* Respuestas en hilo */}
      <ThreadPanel
        open={!!threadParent}
        parent={threadParent}
        replies={replies}
        channel={activeChannel}
        people={rail.people}
        presence={presence}
        mentions={mentions}
        currentUserId={currentUserId}
        loading={repliesLoading}
        onClose={() => setThreadParent(null)}
        onSend={(body, attachments) => {
          if (!activeChannel || !threadParent) return;
          send(activeChannel.id, body, attachments, threadParent.id);
        }}
        onTyping={() => activeChannel && sendTyping(activeChannel.id)}
        onToggleReaction={toggleReaction}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onTogglePin={togglePin}
        onToggleSave={toggleSave}
        onRetry={retry}
        onAction={runAction}
      />
    </div>
  );
}

/** Añade o quita mi reacción de una píldora, sin esperar al servidor. */
function flipReaction(
  message: ImMessageDTO,
  emoji: string,
  userId: string,
): ImMessageDTO['reactions'] {
  const existing = message.reactions.find((r) => r.emoji === emoji);
  if (!existing) {
    return [...message.reactions, { emoji, count: 1, userIds: [userId] }];
  }
  const mine = existing.userIds.includes(userId);
  const next = message.reactions
    .map((r) =>
      r.emoji === emoji
        ? {
            ...r,
            count: Math.max(0, r.count + (mine ? -1 : 1)),
            userIds: mine ? r.userIds.filter((u) => u !== userId) : [...r.userIds, userId],
          }
        : r,
    )
    .filter((r) => r.count > 0);
  return next;
}
