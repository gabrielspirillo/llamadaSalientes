'use client';

import { UserButton } from '@clerk/nextjs';
import { ArrowRight, Bell, Calendar, Check, MessageCircle, Phone, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type SearchHit =
  | { kind: 'call'; id: string; title: string; subtitle: string; href: string; when: string | null }
  | { kind: 'treatment'; id: string; title: string; subtitle: string; href: string; when: null };

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
  reagendar: 'bg-blue-500',
  cancelar: 'bg-amber-500',
  consulta: 'bg-violet-500',
  queja: 'bg-red-500',
  transferida: 'bg-orange-500',
  otro: 'bg-zinc-400',
};

export function DashboardTopbar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

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

  return (
    <>
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-white/70 backdrop-blur-xl px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center gap-2 rounded-full bg-zinc-100 hover:bg-zinc-200 transition-colors px-3 py-1.5 text-sm text-zinc-500 w-72"
          >
            <Search className="h-3.5 w-3.5" />
            Buscar llamadas, pacientes…
            <kbd className="ml-auto text-xs text-zinc-400">⌘K</kbd>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <NotificationsBell open={notifOpen} onToggle={() => setNotifOpen((v) => !v)} onClose={() => setNotifOpen(false)} />
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'h-8 w-8 ring-2 ring-white',
              },
            }}
          />
        </div>
      </header>

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
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        if (res.ok) {
          const data = (await res.json()) as { hits: SearchHit[] };
          setHits(data.hits ?? []);
        }
      } catch {}
      setLoading(false);
    }, 200);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [q]);

  function onPick(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-w-[95vw] bg-white rounded-2xl shadow-2xl border border-zinc-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por número, paciente, resumen, tratamiento…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-zinc-400"
          />
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="px-6 py-12 text-center text-sm text-zinc-400">
              Escribí al menos 2 caracteres para buscar
            </div>
          ) : loading && hits.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-zinc-400">Buscando…</div>
          ) : hits.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-zinc-400">
              Sin resultados para “{q}”
            </div>
          ) : (
            <ul>
              {hits.map((h) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button"
                    onClick={() => onPick(h.href)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 text-left transition-colors"
                  >
                    <div className="h-8 w-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 text-zinc-600">
                      {h.kind === 'call' ? (
                        <Phone className="h-4 w-4" />
                      ) : (
                        <Calendar className="h-4 w-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{h.title}</p>
                      <p className="text-xs text-zinc-500 truncate">{h.subtitle}</p>
                    </div>
                    {h.when && (
                      <span className="text-xs text-zinc-400 shrink-0 tabular-nums">
                        {new Date(h.when).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400 flex items-center justify-between bg-zinc-50/50">
          <span>↵ para abrir · Esc para cerrar</span>
          <span>{hits.length} resultados</span>
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
  const unreadCount = visible.filter((i) => new Date(i.createdAt).getTime() > lastSeenAt).length;

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
        className="relative h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-4 w-4 text-zinc-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          data-notif-panel
          className="absolute right-0 mt-2 w-[380px] max-h-[70vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-zinc-200 z-50 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Notificaciones</h3>
              <p className="text-[11px] text-zinc-500">
                {visible.length} {visible.length === 1 ? 'reciente' : 'recientes'}
              </p>
            </div>
            {visible.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
                title="Limpiar todas"
              >
                <Check className="h-3 w-3" />
                Limpiar
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && visible.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-zinc-400">Cargando…</div>
            ) : visible.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <MessageCircle className="mx-auto h-6 w-6 text-zinc-300 mb-2" />
                <p className="text-sm text-zinc-500">Estás al día.</p>
                <p className="text-xs text-zinc-400 mt-1">Las nuevas llamadas aparecen acá.</p>
              </div>
            ) : (
              <ul>
                {visible.map((n) => {
                  const isUnread = new Date(n.createdAt).getTime() > lastSeenAt;
                  return (
                    <li
                      key={n.id}
                      className="group relative border-b border-zinc-50 last:border-b-0"
                    >
                      <Link
                        href={`/dashboard/calls/${n.callId}`}
                        onClick={onClose}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                      >
                        <div
                          className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${KIND_DOT[n.kind]}`}
                        />
                        <div className="flex-1 min-w-0 pr-7">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{n.title}</p>
                            {isUnread && (
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 truncate">{n.detail}</p>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            {timeAgo(n.createdAt)}
                          </p>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dismissOne(n.id);
                        }}
                        className="absolute top-3 right-3 h-5 w-5 inline-flex items-center justify-center rounded-md text-zinc-300 hover:text-zinc-700 hover:bg-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
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

          <div className="border-t border-zinc-100 bg-zinc-50/60 shrink-0">
            <Link
              href="/dashboard/calls"
              onClick={onClose}
              className="flex items-center justify-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-zinc-900 hover:bg-zinc-100 py-3 transition-colors"
            >
              Ver todas las llamadas
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
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
