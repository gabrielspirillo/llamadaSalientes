'use client';

import { DashboardSidebarMobile } from '@/components/dashboard/sidebar';
import { TeamMenu } from '@/components/dashboard/team-menu';
import { useMessaging } from '@/components/messaging/MessagingProvider';
import { MentionsInbox } from '@/components/messaging/dock/MentionsInbox';
import { StatusDot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { Avatar } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { ImSearchHit } from '@/lib/messaging/types';
import type { EnabledModules } from '@/lib/modules';
import { UserButton, useUser } from '@clerk/nextjs';
import {
  ArrowRight,
  AtSign,
  Bell,
  Calendar,
  Check,
  Contact,
  Hash,
  Menu,
  MessageCircle,
  MessageSquare,
  Phone,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type SearchHit =
  | { kind: 'call'; id: string; title: string; subtitle: string; href: string; when: string | null }
  | { kind: 'treatment'; id: string; title: string; subtitle: string; href: string; when: null }
  | { kind: 'contact'; id: string; title: string; subtitle: string; href: string; when: null }
  | { kind: 'channel'; id: string; title: string; subtitle: string; href: string; when: null }
  | {
      kind: 'message';
      id: string;
      title: string;
      subtitle: string;
      href: string;
      when: string | null;
    };

type Notification = {
  id: string;
  kind: 'agendar' | 'reagendar' | 'cancelar' | 'consulta' | 'queja' | 'transferida' | 'otro';
  title: string;
  detail: string;
  callId: string;
  createdAt: string;
};

const KIND_DOT: Record<Notification['kind'], string> = {
  agendar: 'bg-emerald-500',
  reagendar: 'bg-sky-500',
  cancelar: 'bg-amber-500',
  consulta: 'bg-brand-500',
  queja: 'bg-rose-500',
  transferida: 'bg-orange-500',
  otro: 'bg-zinc-400',
};

/** Saludo según la hora local — pequeño detalle que humaniza el panel. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export function DashboardTopbar({
  enabledModules,
  isSuperAdmin = false,
  impersonatingClinic,
  tasksBadge = 0,
  messagesBadge = 0,
}: {
  enabledModules: EnabledModules;
  isSuperAdmin?: boolean;
  impersonatingClinic?: string;
  tasksBadge?: number;
  messagesBadge?: number;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [hello, setHello] = useState('Hola');
  const { user } = useUser();

  // El saludo depende de la hora del cliente: se calcula tras montar para
  // evitar desajustes de hidratación con el render del servidor.
  useEffect(() => setHello(greeting()), []);

  // Cmd-K abre el buscador
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const firstName = user?.firstName ?? user?.fullName?.split(' ')[0] ?? '';

  return (
    <>
      <header className="sticky top-0 z-40 flex h-[68px] items-center justify-between gap-3 border-b border-black/10 bg-[linear-gradient(180deg,#3f7061,#315e52)] px-4 shadow-[0_10px_30px_-24px_rgba(20,33,29,0.9)] sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menú"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/85 transition-all hover:bg-white/15 hover:text-white active:scale-95 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-1.5 lg:hidden"
            aria-label="FUTURA"
          >
            <span className="text-[18px] font-extrabold leading-none tracking-tight text-white">
              FUTURA
            </span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#bff0dd]" />
          </Link>

          {/* Saludo — equivalente al "Welcome, …" de la referencia */}
          <div className="hidden min-w-0 lg:block">
            <p className="text-[14px] font-medium leading-none text-white/70">{hello},</p>
            <p className="mt-1.5 truncate text-[22px] font-extrabold leading-none tracking-tight text-white">
              {firstName || 'bienvenido'}
            </p>
          </div>

          {/* Buscador — pastilla ancha como en el tablero de referencia */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className={cn(
              'group hidden items-center gap-2.5 rounded-full border border-white/25 bg-white/15 px-4 py-2.5 text-sm text-white/80',
              'w-full max-w-md transition-all duration-300 hover:border-white/40 hover:bg-white/25 md:flex',
            )}
          >
            <Search className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110" />
            <span className="truncate">Buscar llamadas, pacientes, mensajes…</span>
            <kbd className="ml-auto shrink-0 rounded-lg bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold text-white/85">
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          {impersonatingClinic && (
            <span className="hidden max-w-[220px] items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/20 sm:inline-flex">
              <StatusDot tone="success" />
              <span className="truncate">Gestionando: {impersonatingClinic}</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Buscar"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/85 transition-all hover:bg-white/15 hover:text-white active:scale-95 md:hidden"
          >
            <Search className="h-4 w-4" />
          </button>

          <NotificationsBell
            open={notifOpen}
            onToggle={() => setNotifOpen((v) => !v)}
            onClose={() => setNotifOpen(false)}
          />

          <TeamMenu />

          <div className="ml-0.5 rounded-full p-1 ring-1 ring-white/25 transition-all hover:ring-white/50">
            <UserButton
              appearance={{
                elements: { avatarBox: 'h-11 w-11' },
              }}
            />
          </div>
        </div>
      </header>

      <DashboardSidebarMobile
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        enabledModules={enabledModules}
        isSuperAdmin={isSuperAdmin}
        tasksBadge={tasksBadge}
        messagesBadge={messagesBadge}
      />
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
    </>
  );
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { channels } = useMessaging();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);

      // Canales: se filtran en memoria, ya vienen en el rail.
      const needle = q.trim().toLowerCase();
      const channelHits: SearchHit[] = channels
        .filter((c) => !c.archived && c.name.toLowerCase().includes(needle))
        .slice(0, 4)
        .map((c) => ({
          kind: 'channel' as const,
          id: c.id,
          title: c.name,
          subtitle: c.kind === 'DM' ? 'Mensaje directo' : (c.topic ?? 'Canal del equipo'),
          href: `/dashboard/messages?channel=${c.id}`,
          when: null,
        }));

      // Las dos búsquedas van en paralelo. Que Mensajes falle (migración sin
      // aplicar, módulo caído) NO puede romper el buscador que ya existía.
      const [general, messages] = await Promise.all([
        fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal })
          .then((r) => (r.ok ? (r.json() as Promise<{ hits?: SearchHit[] }>) : null))
          .catch(() => null),
        fetch(`/api/messages/search?q=${encodeURIComponent(q)}&limit=6`, { signal: ac.signal })
          .then((r) => (r.ok ? (r.json() as Promise<{ hits?: ImSearchHit[] }>) : null))
          .catch(() => null),
      ]);

      const messageHits: SearchHit[] = (messages?.hits ?? []).map((h) => ({
        kind: 'message' as const,
        id: h.messageId,
        title: h.snippet,
        subtitle: `${h.channelName}${h.senderName ? ` · ${h.senderName}` : ''}`,
        href: `/dashboard/messages?channel=${h.channelId}&message=${h.messageId}`,
        when: h.createdAt,
      }));

      if (!ac.signal.aborted) {
        setHits([...channelHits, ...messageHits, ...(general?.hits ?? [])]);
        setLoading(false);
      }
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q, channels]);

  function onPick(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center bg-[#14211d]/25 pt-[10vh] backdrop-blur-sm">
      {/* El fondo es un botón, no un div con onClick: así se puede cerrar con
          teclado y no sólo con el ratón. Va detrás del panel con -z-10. */}
      <button
        type="button"
        aria-label="Cerrar la búsqueda"
        className="absolute inset-0 -z-10 cursor-default"
        onClick={onClose}
      />
      <div className="w-[620px] max-w-[95vw] animate-pop overflow-hidden rounded-[26px] border border-white/70 bg-white/90 shadow-[0_40px_90px_-30px_rgba(20,33,29,0.4)] backdrop-blur-2xl">
        <div className="relative flex items-center gap-3 border-b border-[--color-border-subtle] px-5 py-4">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(95,168,150,0.12),transparent_70%)]"
          />
          <Search className="relative h-4 w-4 shrink-0 text-brand-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por número, paciente, resumen, tratamiento, mensaje…"
            className="relative flex-1 bg-transparent text-[16px] outline-none placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="relative rounded-full p-1.5 text-zinc-400 transition-all hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <EmptyState
              icon={<Search className="h-5 w-5" />}
              title="Empezá a escribir"
              description="Mínimo 2 caracteres. Buscamos en llamadas, contactos, tratamientos y mensajes del equipo."
            />
          ) : loading && hits.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-zinc-500">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
              <p className="mt-3">Buscando…</p>
            </div>
          ) : hits.length === 0 ? (
            <EmptyState
              title={`Sin resultados para “${q}”`}
              description="Prueba con otro término."
            />
          ) : (
            <ul className="stagger p-2" style={{ ['--stagger-step' as string]: '35ms' }}>
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`} style={{ ['--i' as string]: i }}>
                  <button
                    type="button"
                    onClick={() => onPick(h.href)}
                    className="group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all duration-200 hover:bg-zinc-50"
                  >
                    <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 ring-1 ring-[--color-border] transition-transform duration-300 group-hover:scale-110">
                      {h.kind === 'call' ? (
                        <Phone className="h-4 w-4" />
                      ) : h.kind === 'contact' ? (
                        <Contact className="h-4 w-4" />
                      ) : h.kind === 'channel' ? (
                        <Hash className="h-4 w-4" />
                      ) : h.kind === 'message' ? (
                        <MessageSquare className="h-4 w-4" />
                      ) : (
                        <Calendar className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-800">{h.title}</p>
                      <p className="truncate text-xs text-zinc-500">{h.subtitle}</p>
                    </div>
                    {h.when && (
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                        {new Date(h.when).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </span>
                    )}
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 -translate-x-1 text-zinc-300 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[--color-border-subtle] bg-[#fafbfb] px-5 py-2.5 text-[12px] text-zinc-500">
          <span>↵ para abrir · Esc para cerrar</span>
          <span className="tabular-nums">{hits.length} resultados</span>
        </div>
      </div>
    </div>
  );
}

const NOTIF_LAST_SEEN_KEY = 'futura.notif.lastSeenAt';

function NotificationsBell({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // Menciones del módulo Mensajes: el "leído" vive en el server
  // (im_mentions.read_at), no en localStorage como el de llamadas.
  const { mentions, ready: messagingReady } = useMessaging();
  const [tab, setTab] = useState<'calls' | 'mentions'>('calls');
  const [lastSeenAt, setLastSeenAt] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const v = window.localStorage.getItem(NOTIF_LAST_SEEN_KEY);
    return v ? Number(v) : 0;
  });

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/notifications');
        if (res.ok && mounted) {
          const data = (await res.json()) as { items: Notification[] };
          setItems(data.items ?? []);
        }
      } catch {}
      if (mounted) setLoading(false);
    }
    load();
    const iv = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, []);

  // Click outside cierra
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-notif-panel]') && !target.closest('[data-notif-bell]')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  const visible = items.filter((i) => !dismissed.has(i.id));
  const callsUnread = visible.filter((i) => new Date(i.createdAt).getTime() > lastSeenAt).length;
  const mentionsUnread = mentions.filter((m) => !m.readAt).length;
  const unreadCount = callsUnread + mentionsUnread;

  // Si hay menciones sin leer, se abre directo en esa pestaña: es lo que pide
  // una respuesta de una persona, no de un agente.
  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al abrir el panel
  useEffect(() => {
    if (!open) return;
    setTab(mentionsUnread > 0 ? 'mentions' : 'calls');
  }, [open]);

  function markAllRead() {
    const now = Date.now();
    setLastSeenAt(now);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(NOTIF_LAST_SEEN_KEY, String(now));
    }
  }

  function clearAll() {
    setDismissed(new Set(items.map((i) => i.id)));
    markAllRead();
  }

  function dismissOne(id: string) {
    setDismissed((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-notif-bell
        onClick={() => {
          onToggle();
          if (!open) markAllRead(); // al abrir, marcar como vistas
        }}
        className={cn(
          'relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-95',
          open ? 'bg-white/25 text-white' : 'text-white/85 hover:bg-white/15 hover:text-white',
        )}
        aria-label="Notificaciones"
      >
        <Bell className={cn('h-4 w-4', unreadCount > 0 && 'animate-pulse-soft')} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-[linear-gradient(120deg,#f43f5e,#fb7185)] px-1 text-[11px] font-bold text-white ring-2 ring-[#315e52]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          data-notif-panel
          className="fixed left-2 right-2 z-50 mt-2 flex max-h-[75vh] animate-fade-down flex-col overflow-hidden rounded-[24px] border border-white/60 bg-white shadow-[0_40px_90px_-30px_rgba(20,33,29,0.5)] sm:absolute sm:left-auto sm:right-0 sm:max-h-[70vh] sm:w-[390px] sm:max-w-[calc(100vw-1rem)]"
        >
          <div className="relative flex shrink-0 items-center justify-between border-b border-[--color-border-subtle] px-5 py-3.5">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(95,168,150,0.12),transparent_70%)]"
            />
            <div className="relative">
              <h3 className="text-sm font-bold tracking-tight text-zinc-900">Notificaciones</h3>
              <p className="text-[12px] text-zinc-500">
                {tab === 'calls'
                  ? `${visible.length} ${visible.length === 1 ? 'reciente' : 'recientes'}`
                  : `${mentions.length} ${mentions.length === 1 ? 'mención' : 'menciones'}`}
              </p>
            </div>
            {tab === 'calls' && visible.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="relative inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                title="Limpiar todas"
              >
                <Check className="h-3 w-3" />
                Limpiar
              </button>
            )}
          </div>

          {messagingReady && (
            <div className="flex shrink-0 gap-1 border-b border-[--color-border-subtle] px-3 py-2">
              <BellTab
                active={tab === 'calls'}
                onClick={() => setTab('calls')}
                icon={<Phone className="h-3 w-3" />}
                label="Llamadas"
                badge={callsUnread}
              />
              <BellTab
                active={tab === 'mentions'}
                onClick={() => setTab('mentions')}
                icon={<AtSign className="h-3 w-3" />}
                label="Menciones"
                badge={mentionsUnread}
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {messagingReady && tab === 'mentions' ? (
              <MentionsInbox />
            ) : loading && visible.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-zinc-500">Cargando…</div>
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<MessageCircle className="h-5 w-5" />}
                title="Estás al día"
                description="Las nuevas llamadas del agente aparecen acá."
              />
            ) : (
              <ul className="stagger p-2" style={{ ['--stagger-step' as string]: '40ms' }}>
                {visible.map((n, i) => {
                  const isUnread = new Date(n.createdAt).getTime() > lastSeenAt;
                  return (
                    <li key={n.id} className="group relative" style={{ ['--i' as string]: i }}>
                      <Link
                        href={`/dashboard/calls/${n.callId}`}
                        onClick={onClose}
                        className={cn(
                          'flex items-start gap-3 rounded-2xl px-3 py-3 transition-all duration-200 hover:bg-zinc-50',
                          isUnread && 'bg-zinc-50',
                        )}
                      >
                        <span
                          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND_DOT[n.kind])}
                        />
                        <div className="min-w-0 flex-1 pr-7">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-zinc-800">{n.title}</p>
                            {isUnread && (
                              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
                            )}
                          </div>
                          <p className="truncate text-xs text-zinc-500">{n.detail}</p>
                          <p className="mt-0.5 text-[12px] text-zinc-500">{timeAgo(n.createdAt)}</p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dismissOne(n.id);
                        }}
                        className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 opacity-100 transition-all hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700 sm:opacity-0 sm:group-hover:opacity-100"
                        title="Descartar"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-[--color-border-subtle] bg-[#fafbfb]">
            <Link
              href={
                messagingReady && tab === 'mentions' ? '/dashboard/messages' : '/dashboard/calls'
              }
              onClick={onClose}
              className="group flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-brand-700"
            >
              {messagingReady && tab === 'mentions' ? 'Abrir Mensajes' : 'Ver todas las llamadas'}
              <ArrowRight className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pestaña de la campana. Píldora en gradiente cuando está activa. */
function BellTab({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-all duration-300',
        active
          ? 'bg-[linear-gradient(120deg,#37766a,#5fa896)] text-white shadow-[0_8px_18px_-10px_rgba(55,118,106,0.85)]'
          : 'text-zinc-500 hover:bg-brand-50 hover:text-brand-700',
      )}
    >
      {icon}
      {label}
      {badge > 0 && (
        <span
          className={cn(
            'inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums',
            active ? 'bg-white/25 text-white' : 'bg-rose-500 text-white',
          )}
        >
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'hace instantes';
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.round(hr / 24);
  if (days < 7) return `hace ${days} días`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}
