'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type NotifToast,
  type NotificationsApi,
  useNotifications,
} from '@/components/messaging/dock/useNotifications';
import { cn } from '@/lib/cn';
import type { ImRealtimeEvent, ImRealtimeEventKind } from '@/lib/messaging/events';
import type {
  ImChannelDTO,
  ImMentionDTO,
  ImMessageDTO,
  ImPerson,
  ImPresence,
  ImRailDTO,
} from '@/lib/messaging/types';
import { AtSign, MessageSquare, X } from 'lucide-react';

/* ============================================================================
   Contexto del módulo Mensajes.

   Es el ÚNICO dueño del EventSource a /api/messages/stream: una sola conexión
   por pestaña, sin importar cuántas superficies (dock, campana, página) estén
   montadas. El resto se engancha con `subscribe(kind, handler)`.

   Degrada en silencio: si /api/messages/rail responde 401/404/500 —por ejemplo
   porque la migración 0019 todavía no se aplicó— el contexto queda vacío, no se
   abre el stream y NADA del panel se rompe.
   ========================================================================== */

const DOCK_OPEN_KEY = 'futura.dock.open';
const DOCK_CHANNEL_KEY = 'futura.dock.channel';

/** TTL local del "está escribiendo" (el server ya expira la clave en Redis). */
const TYPING_TTL_MS = 6_000;

const EVENT_KINDS: readonly ImRealtimeEventKind[] = [
  'message.new',
  'message.updated',
  'message.deleted',
  'reaction.changed',
  'channel.updated',
  'channel.member_joined',
  'channel.member_left',
  'typing.start',
  'typing.stop',
  'presence.changed',
  'unread.changed',
  'mention.new',
] as const;

export type ImEventHandler = (event: ImRealtimeEvent) => void;

export interface TypingPeer {
  userId: string;
  name: string;
}

export interface MessagingContextValue {
  /** Null mientras carga o si el módulo no está disponible. */
  rail: ImRailDTO | null;
  channels: ImChannelDTO[];
  people: ImPerson[];
  presence: ImPresence[];
  mentions: ImMentionDTO[];
  totalUnread: number;
  totalMentions: number;
  /** true cuando el rail cargó bien al menos una vez. */
  ready: boolean;
  /** true si la API contestó error: el módulo no está disponible todavía. */
  degraded: boolean;
  dockOpen: boolean;
  activeChannelId: string | null;

  setDockOpen(open: boolean): void;
  openChannel(channelId: string): void;
  openDmWith(userId: string): Promise<void>;
  sendMessage(
    channelId: string,
    body: string,
    opts?: { clientNonce?: string; parentId?: string | null },
  ): Promise<ImMessageDTO | null>;
  markRead(channelId: string, upToMessageId?: string | null): Promise<void>;
  resolveMention(mentionId: string): Promise<void>;
  refreshRail(): Promise<void>;
  refreshMentions(): Promise<void>;
  subscribe(kind: ImRealtimeEventKind | '*', handler: ImEventHandler): () => void;
  /**
   * true solo dentro del provider. Lo usa useMessagingStream para delegar en
   * esta conexión en vez de abrir un segundo EventSource: el diseño es UNA
   * conexión SSE por usuario, no una por superficie montada.
   */
  mounted: boolean;
  /** true mientras el EventSource está vivo. Pasa a false en un corte. */
  connected: boolean;
  channelById(channelId: string): ImChannelDTO | null;
  isOnline(userId: string): boolean;
  notifications: NotificationsApi;
}

const NOOP_NOTIFICATIONS: NotificationsApi = {
  soundEnabled: false,
  setSoundEnabled: () => {},
  toastsEnabled: false,
  setToastsEnabled: () => {},
  desktopPermission: 'unsupported',
  requestDesktopPermission: () => {},
  toasts: [],
  dismissToast: () => {},
  clearToasts: () => {},
};

/**
 * Valor por defecto inerte. Que el contexto NO lance si alguien consume el hook
 * fuera del provider es deliberado: el sidebar y la topbar se montan también en
 * pantallas donde el provider podría no estar.
 */
const DEFAULT_VALUE: MessagingContextValue = {
  rail: null,
  channels: [],
  people: [],
  presence: [],
  mentions: [],
  totalUnread: 0,
  totalMentions: 0,
  ready: false,
  degraded: false,
  dockOpen: false,
  activeChannelId: null,
  setDockOpen: () => {},
  openChannel: () => {},
  openDmWith: async () => {},
  sendMessage: async () => null,
  markRead: async () => {},
  resolveMention: async () => {},
  refreshRail: async () => {},
  refreshMentions: async () => {},
  subscribe: () => () => {},
  mounted: false,
  connected: false,
  channelById: () => null,
  isOnline: () => false,
  notifications: NOOP_NOTIFICATIONS,
};

const EMPTY_CHANNELS: ImChannelDTO[] = [];
const EMPTY_PEOPLE: ImPerson[] = [];
const EMPTY_PRESENCE: ImPresence[] = [];

const MessagingContext = createContext<MessagingContextValue>(DEFAULT_VALUE);

/**
 * `typing` vive en su propio contexto.
 *
 * Es el estado que más cambia de todo el módulo (un evento cada 3 s por cada
 * persona que esté escribiendo, en cualquier canal del tenant). Mientras
 * formaba parte del value principal, cada tecleo ajeno invalidaba el memo y
 * re-renderizaba el sidebar, la topbar y el dock enteros. Separado, sólo
 * re-renderiza a quien de verdad muestra el "está escribiendo…".
 */
const TypingContext = createContext<(channelId: string) => TypingPeer[]>(() => []);

export function useMessaging(): MessagingContextValue {
  return useContext(MessagingContext);
}

/** Peers escribiendo en un canal. Sólo para quien pinta el indicador. */
export function useTypingIn(): (channelId: string) => TypingPeer[] {
  return useContext(TypingContext);
}

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const [rail, setRail] = useState<ImRailDTO | null>(null);
  const [mentions, setMentions] = useState<ImMentionDTO[]>([]);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [dockOpen, setDockOpenState] = useState(false);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [typing, setTyping] = useState<
    Record<string, { userId: string; name: string; until: number }[]>
  >({});

  const subscribersRef = useRef<Map<string, Set<ImEventHandler>>>(new Map());
  const esRef = useRef<EventSource | null>(null);
  const railRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* --- Preferencias persistidas (dock) --------------------------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setDockOpenState(window.localStorage.getItem(DOCK_OPEN_KEY) === '1');
      const ch = window.localStorage.getItem(DOCK_CHANNEL_KEY);
      if (ch) setActiveChannelId(ch);
    } catch {
      /* localStorage bloqueado: seguimos con los valores por defecto */
    }
  }, []);

  const setDockOpen = useCallback((open: boolean) => {
    setDockOpenState(open);
    try {
      window.localStorage.setItem(DOCK_OPEN_KEY, open ? '1' : '0');
    } catch {
      /* nada */
    }
  }, []);

  /* --- Hidratación del rail -------------------------------------------- */
  const refreshRail = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/rail', { cache: 'no-store' });
      if (!res.ok) {
        if (mountedRef.current) setDegraded(true);
        return;
      }
      const data = (await res.json()) as { rail?: ImRailDTO };
      if (!data?.rail || !mountedRef.current) return;
      setRail(data.rail);
      setReady(true);
      setDegraded(false);
    } catch {
      if (mountedRef.current) setDegraded(true);
    }
  }, []);

  const scheduleRailRefresh = useCallback(() => {
    if (railRefreshTimer.current) clearTimeout(railRefreshTimer.current);
    railRefreshTimer.current = setTimeout(() => {
      void refreshRail();
    }, 800);
  }, [refreshRail]);

  const refreshMentions = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/mentions', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { mentions?: ImMentionDTO[] };
      if (mountedRef.current) setMentions(data?.mentions ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  useEffect(() => {
    void refreshRail();
  }, [refreshRail]);

  useEffect(() => {
    if (!ready) return;
    void refreshMentions();
  }, [ready, refreshMentions]);

  /* --- Aplicación de eventos al rail ------------------------------------ */
  const patchChannel = useCallback((channelId: string, patch: Partial<ImChannelDTO>) => {
    setRail((prev) => {
      if (!prev) return prev;
      let touched = false;
      const channels = prev.channels.map((c) => {
        if (c.id !== channelId) return c;
        touched = true;
        return { ...c, ...patch };
      });
      if (!touched) return prev;
      return { ...prev, channels };
    });
  }, []);

  const applyEvent = useCallback(
    (event: ImRealtimeEvent) => {
      switch (event.kind) {
        case 'unread.changed': {
          setRail((prev) => {
            if (!prev) return prev;
            const known = prev.channels.some((c) => c.id === event.channelId);
            if (!known) return prev;
            return {
              ...prev,
              totalUnread: event.totalUnread,
              totalMentions: event.totalMentions,
              channels: prev.channels.map((c) =>
                c.id === event.channelId
                  ? { ...c, unreadCount: event.unreadCount, mentionCount: event.mentionCount }
                  : c,
              ),
            };
          });
          break;
        }
        case 'message.new': {
          const preview = event.message.body?.slice(0, 140) ?? '';
          setRail((prev) => {
            if (!prev) return prev;
            const known = prev.channels.some((c) => c.id === event.channelId);
            // Canal nuevo (te acaban de sumar): recargamos el rail entero.
            if (!known) {
              scheduleRailRefresh();
              return prev;
            }
            return {
              ...prev,
              channels: prev.channels.map((c) =>
                c.id === event.channelId
                  ? {
                      ...c,
                      lastMessageAt: event.message.createdAt,
                      lastMessagePreview: preview,
                      messageCount: c.messageCount + 1,
                    }
                  : c,
              ),
            };
          });
          break;
        }
        case 'mention.new': {
          void refreshMentions();
          break;
        }
        case 'presence.changed': {
          setRail((prev) => {
            if (!prev) return prev;
            const rest = prev.presence.filter((p) => p.userId !== event.presence.userId);
            return { ...prev, presence: [...rest, event.presence] };
          });
          break;
        }
        case 'typing.start': {
          const until = Date.now() + TYPING_TTL_MS;
          setTyping((prev) => {
            const list = (prev[event.channelId] ?? []).filter((p) => p.userId !== event.userId);
            return {
              ...prev,
              [event.channelId]: [...list, { userId: event.userId, name: event.name, until }],
            };
          });
          break;
        }
        case 'typing.stop': {
          setTyping((prev) => {
            const list = (prev[event.channelId] ?? []).filter((p) => p.userId !== event.userId);
            return { ...prev, [event.channelId]: list };
          });
          break;
        }
        case 'channel.updated':
        case 'channel.member_joined':
        case 'channel.member_left': {
          scheduleRailRefresh();
          break;
        }
        default:
          break;
      }
    },
    [refreshMentions, scheduleRailRefresh],
  );

  /* --- El único EventSource --------------------------------------------- */
  useEffect(() => {
    if (!ready) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (esRef.current) return;

    let es: EventSource;
    try {
      es = new EventSource('/api/messages/stream');
    } catch {
      return;
    }
    esRef.current = es;

    const dispatch = (raw: string) => {
      let event: ImRealtimeEvent;
      try {
        event = JSON.parse(raw) as ImRealtimeEvent;
      } catch {
        return;
      }
      applyEvent(event);
      const exact = subscribersRef.current.get(event.kind);
      if (exact) for (const h of Array.from(exact)) h(event);
      const wild = subscribersRef.current.get('*');
      if (wild) for (const h of Array.from(wild)) h(event);
    };

    const listeners = EVENT_KINDS.map((kind) => {
      const fn = (e: MessageEvent<string>) => dispatch(e.data);
      es.addEventListener(kind, fn as EventListener);
      return [kind, fn] as const;
    });

    // Durante un corte no hay backlog: los eventos que ocurrieron mientras
    // estuvimos caídos se perdieron. Por eso al recuperar la conexión hay que
    // resincronizar contra el rail en vez de confiar en el stream.
    let hadError = false;
    const onOpen = () => {
      setConnected(true);
      if (hadError) {
        hadError = false;
        void refreshRail();
        void refreshMentions();
      }
    };
    const onError = () => {
      // No cerramos: EventSource reintenta solo con el backoff del navegador.
      hadError = true;
      setConnected(false);
    };
    es.addEventListener('open', onOpen);
    es.addEventListener('error', onError);

    return () => {
      for (const [kind, fn] of listeners) es.removeEventListener(kind, fn as EventListener);
      es.removeEventListener('open', onOpen);
      es.removeEventListener('error', onError);
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [ready, applyEvent, refreshRail, refreshMentions]);

  /* --- Purga del "está escribiendo" ------------------------------------- */
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [channelId, list] of Object.entries(prev)) {
          const alive = list.filter((p) => p.until > now);
          if (alive.length !== list.length) changed = true;
          if (alive.length > 0) next[channelId] = alive;
          else if (list.length > 0) changed = true;
        }
        return changed ? next : prev;
      });
    }, 2_000);
    return () => clearInterval(iv);
  }, []);

  /* --- Acciones ---------------------------------------------------------- */
  const subscribe = useCallback((kind: ImRealtimeEventKind | '*', handler: ImEventHandler) => {
    const map = subscribersRef.current;
    let set = map.get(kind);
    if (!set) {
      set = new Set();
      map.set(kind, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }, []);

  const openChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      try {
        window.localStorage.setItem(DOCK_CHANNEL_KEY, channelId);
      } catch {
        /* nada */
      }
      setDockOpen(true);
    },
    [setDockOpen],
  );

  const openDmWith = useCallback(
    async (userId: string) => {
      try {
        const res = await fetch('/api/messages/channels/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { id?: string };
        if (!data?.id) return;
        await refreshRail();
        openChannel(data.id);
      } catch {
        /* best-effort */
      }
    },
    [openChannel, refreshRail],
  );

  const sendMessage = useCallback<MessagingContextValue['sendMessage']>(
    async (channelId, body, opts) => {
      try {
        const res = await fetch(`/api/messages/channels/${channelId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body,
            clientNonce: opts?.clientNonce ?? null,
            parentId: opts?.parentId ?? null,
          }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { message?: ImMessageDTO };
        return data?.message ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

  const markRead = useCallback<MessagingContextValue['markRead']>(
    async (channelId, upToMessageId) => {
      // Optimista: el badge baja ya; el server confirma por SSE.
      setRail((prev) => {
        if (!prev) return prev;
        const target = prev.channels.find((c) => c.id === channelId);
        if (!target || (target.unreadCount === 0 && target.mentionCount === 0)) return prev;
        return {
          ...prev,
          totalUnread: Math.max(0, prev.totalUnread - target.unreadCount),
          totalMentions: Math.max(0, prev.totalMentions - target.mentionCount),
          channels: prev.channels.map((c) =>
            c.id === channelId ? { ...c, unreadCount: 0, mentionCount: 0 } : c,
          ),
        };
      });
      try {
        await fetch(`/api/messages/channels/${channelId}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upToMessageId: upToMessageId ?? null }),
        });
      } catch {
        /* best-effort */
      }
    },
    [],
  );

  const resolveMention = useCallback(
    async (mentionId: string) => {
      setMentions((prev) => prev.filter((m) => m.id !== mentionId));
      try {
        await fetch(`/api/messages/mentions/${mentionId}/resolve`, { method: 'POST' });
      } catch {
        /* best-effort */
      }
      void refreshMentions();
    },
    [refreshMentions],
  );

  // Constantes compartidas: `?? []` devuelve un array NUEVO en cada render
  // mientras el rail es null, con lo que las callbacks que dependen de ellos
  // cambian de identidad y vuelven a invalidar el memo del contexto.
  const channels = rail?.channels ?? EMPTY_CHANNELS;
  const people = rail?.people ?? EMPTY_PEOPLE;
  const presence = rail?.presence ?? EMPTY_PRESENCE;

  const channelById = useCallback(
    (channelId: string) => channels.find((c) => c.id === channelId) ?? null,
    [channels],
  );

  const isOnline = useCallback(
    (userId: string) => presence.some((p) => p.userId === userId && p.online),
    [presence],
  );

  const typingIn = useCallback(
    (channelId: string): TypingPeer[] =>
      (typing[channelId] ?? []).map((p) => ({ userId: p.userId, name: p.name })),
    [typing],
  );

  const isDmChannel = useCallback(
    (channelId: string) => {
      const c = channels.find((x) => x.id === channelId);
      return c?.kind === 'DM';
    },
    [channels],
  );

  const channelName = useCallback(
    (channelId: string) => channels.find((c) => c.id === channelId)?.name ?? 'un canal',
    [channels],
  );

  const isMutedChannel = useCallback(
    (channelId: string) => channels.find((c) => c.id === channelId)?.muted ?? false,
    [channels],
  );

  const notifications = useNotifications({
    enabled: ready,
    subscribe,
    mentionCount: rail?.totalMentions ?? 0,
    isDmChannel,
    isMutedChannel,
    channelName,
    myUserId: rail?.me?.userId ?? null,
  });

  const value = useMemo<MessagingContextValue>(
    () => ({
      rail,
      channels,
      people,
      presence,
      mentions,
      totalUnread: rail?.totalUnread ?? 0,
      totalMentions: rail?.totalMentions ?? 0,
      ready,
      degraded,
      dockOpen,
      activeChannelId,
      setDockOpen,
      openChannel,
      openDmWith,
      sendMessage,
      markRead,
      resolveMention,
      refreshRail,
      refreshMentions,
      subscribe,
      mounted: true,
      connected,
      channelById,
      isOnline,
      notifications,
    }),
    [
      rail,
      channels,
      people,
      presence,
      mentions,
      ready,
      degraded,
      dockOpen,
      activeChannelId,
      setDockOpen,
      openChannel,
      openDmWith,
      sendMessage,
      markRead,
      resolveMention,
      refreshRail,
      refreshMentions,
      subscribe,
      channelById,
      isOnline,
      notifications,
    ],
  );

  return (
    <MessagingContext.Provider value={value}>
      <TypingContext.Provider value={typingIn}>{children}</TypingContext.Provider>
      <NotificationToasts
        toasts={notifications.toasts}
        onDismiss={notifications.dismissToast}
        onOpen={(channelId) => {
          if (channelId) openChannel(channelId);
        }}
      />
    </MessagingContext.Provider>
  );
}

/* ============================================================================
   Pila de toasts. Vive en el provider y no en el dock a propósito: el aviso
   tiene que llegar también en /dashboard/messages, donde el dock se esconde.
   ========================================================================== */
function NotificationToasts({
  toasts,
  onDismiss,
  onOpen,
}: {
  toasts: NotifToast[];
  onDismiss: (id: string) => void;
  onOpen: (channelId: string | null) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    // Sin `role="status"`: cada toast lleva botones y el contenedor solo anuncia.
    <div
      className="pointer-events-none fixed bottom-24 right-4 z-[70] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2 sm:right-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass pointer-events-auto flex animate-slide-right items-start gap-3 rounded-[22px] p-3 shadow-[0_24px_60px_-24px_rgba(22,26,25,0.55)]"
        >
          <span
            className={cn(
              'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
              t.tone === 'mention'
                ? 'bg-brand-100 text-brand-600'
                : 'bg-emerald-100 text-emerald-600',
            )}
          >
            {t.tone === 'mention' ? (
              <AtSign className="h-4 w-4" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onOpen(t.channelId);
              onDismiss(t.id);
            }}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[14px] font-semibold text-zinc-900">{t.title}</p>
            {t.detail && (
              <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-500">{t.detail}</p>
            )}
            <p className="mt-1 text-[12px] font-semibold text-brand-600">Ir al hilo</p>
          </button>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Descartar aviso"
            className="shrink-0 rounded-full p-1.5 text-zinc-400 transition-all hover:rotate-90 hover:bg-white hover:text-zinc-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
