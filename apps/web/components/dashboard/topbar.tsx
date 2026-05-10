'use client';

import { UserButton } from '@clerk/nextjs';
import { Bell, Calendar, MessageCircle, Phone, Search, X } from 'lucide-react';
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
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/notifications');
        if (res.ok && mounted) {
          const data = (await res.json()) as { items: Notification[] };
          setItems(data.items ?? []);
          // Heurística simple: unread = items en las últimas 4hs
          const cut = Date.now() - 4 * 60 * 60_000;
          setUnread(data.items.filter((i) => new Date(i.createdAt).getTime() > cut).length);
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

  return (
    <div className="relative">
      <button
        type="button"
        data-notif-bell
        onClick={() => {
          onToggle();
          setUnread(0);
        }}
        className="relative h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-zinc-100 transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="h-4 w-4 text-zinc-600" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
        )}
      </button>

      {open && (
        <div
          data-notif-panel
          className="absolute right-0 mt-2 w-[380px] max-h-[70vh] overflow-hidden rounded-2xl bg-white shadow-2xl border border-zinc-200 z-50"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-semibold tracking-tight">Notificaciones</h3>
            <span className="text-xs text-zinc-500">{items.length} recientes</span>
          </div>
          <div className="overflow-y-auto max-h-[60vh]">
            {loading && items.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-zinc-400">Cargando…</div>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <MessageCircle className="mx-auto h-6 w-6 text-zinc-300 mb-2" />
                <p className="text-sm text-zinc-500">Sin notificaciones todavía.</p>
                <p className="text-xs text-zinc-400 mt-1">Las llamadas nuevas aparecen acá.</p>
              </div>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/dashboard/calls/${n.callId}`}
                      onClick={onClose}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
                    >
                      <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${KIND_DOT[n.kind]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{n.title}</p>
                        <p className="text-xs text-zinc-500 truncate">{n.detail}</p>
                        <p className="text-[11px] text-zinc-400 mt-0.5">
                          {timeAgo(n.createdAt)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            href="/dashboard/calls"
            onClick={onClose}
            className="block text-center text-xs font-medium text-violet-600 hover:text-violet-700 py-2.5 border-t border-zinc-100 bg-zinc-50/60"
          >
            Ver todas las llamadas →
          </Link>
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
