'use client';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { MentionsInbox } from '@/components/messaging/dock/MentionsInbox';
import { cn } from '@/lib/cn';
import { ACTIONABLE, type Notice, type NoticeCategory } from '@/lib/notifications/model';
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Bell,
  CalendarX2,
  Check,
  ListChecks,
  ListPlus,
  Loader2,
  MessageCircle,
  Phone,
  PhoneIncoming,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Centro de avisos de la campana. Lo que pide algo («Por hacer»: llamar a
 * alguien, una familia que pide hablar con vosotras, fichas duplicadas, tareas
 * del día) va separado de lo que sólo informa («Actividad»). Cada aviso se
 * acciona desde aquí y se descarta (por persona, se guarda en el servidor).
 */

const SEEN_KEY = 'futura.notif.seenRefs';

const META: Record<NoticeCategory, { icon: typeof Bell; chip: string; label: string }> = {
  call: { icon: Phone, chip: 'bg-rose-50 text-rose-600 ring-rose-100', label: 'Llamar' },
  person: {
    icon: MessageCircle,
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    label: 'Pide hablar con alguien',
  },
  duplicate: {
    icon: UsersRound,
    chip: 'bg-violet-50 text-violet-600 ring-violet-100',
    label: 'Fichas duplicadas',
  },
  task: { icon: ListChecks, chip: 'bg-sky-50 text-sky-600 ring-sky-100', label: 'Tareas' },
  agenda: { icon: CalendarX2, chip: 'bg-amber-50 text-amber-600 ring-amber-100', label: 'Agenda' },
  info: { icon: Sparkles, chip: 'bg-teal-50 text-teal-600 ring-teal-100', label: 'Novedad' },
  voice: {
    icon: PhoneIncoming,
    chip: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
    label: 'Llamada del asistente',
  },
  system: {
    icon: AlertTriangle,
    chip: 'bg-orange-50 text-orange-600 ring-orange-100',
    label: 'Canal',
  },
};

type Tab = 'todo' | 'activity' | 'mentions';

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(refs: Set<string>) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...refs].slice(-300)));
  } catch {}
}

export function NotificationCenter({
  open,
  onToggle,
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [tab, setTab] = useState<Tab>('todo');
  const { mentions, ready: messagingReady } = useMessaging();

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = (await res.json()) as { items?: Notice[] };
        setItems(data.items ?? []);
      }
    } catch {}
    setLoaded(true);
  }, []);

  // Vive en el topbar de TODAS las pantallas: se sondea sólo con la pestaña a
  // la vista y se pone al día al volver a ella o al abrir la campana.
  useEffect(() => {
    setSeen(readSeen());
    void load();
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-notif-panel]') && !target.closest('[data-notif-bell]')) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  const todo = items.filter((n) => ACTIONABLE.has(n.category));
  const activity = items.filter((n) => !ACTIONABLE.has(n.category));
  const mentionsUnread = mentions.filter((m) => !m.readAt).length;
  const unread = items.filter((n) => !seen.has(n.ref)).length + mentionsUnread;

  // biome-ignore lint/correctness/useExhaustiveDependencies: sólo al abrir
  useEffect(() => {
    if (!open) return;
    void load();
    setTab(todo.length > 0 ? 'todo' : mentionsUnread > 0 ? 'mentions' : 'todo');
  }, [open]);

  // Al abrir, lo que está a la vista queda visto (el número de la campana baja).
  useEffect(() => {
    if (!open || items.length === 0) return;
    setSeen((prev) => {
      const next = new Set(prev);
      for (const n of items) next.add(n.ref);
      writeSeen(next);
      return next;
    });
  }, [open, items]);

  async function dismiss(refs: string[]) {
    if (refs.length === 0) return;
    const removed = items.filter((n) => refs.includes(n.ref));
    setItems((prev) => prev.filter((n) => !refs.includes(n.ref)));
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refs }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Si no se guardó, vuelve: un aviso que desaparece y reaparece al
      // recargar es peor que uno que no se fue.
      setItems((prev) => [...prev, ...removed]);
    }
  }

  const list = tab === 'todo' ? todo : tab === 'activity' ? activity : [];
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'todo', label: 'Por hacer', count: todo.length },
    { id: 'activity', label: 'Actividad', count: 0 },
    ...(messagingReady
      ? [{ id: 'mentions' as const, label: 'Menciones', count: mentionsUnread }]
      : []),
  ];
  const tabIndex = Math.max(
    0,
    tabs.findIndex((t) => t.id === tab),
  );

  return (
    <div className="relative">
      <button
        type="button"
        data-notif-bell
        onClick={onToggle}
        className={cn(
          'relative inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300 active:scale-95',
          open ? 'bg-white/25 text-white' : 'text-white/85 hover:bg-white/15 hover:text-white',
        )}
        aria-label={unread > 0 ? `Avisos (${unread} sin ver)` : 'Avisos'}
      >
        <Bell className={cn('h-4 w-4', unread > 0 && 'notif-bell-ring')} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] animate-pop items-center justify-center rounded-full bg-[linear-gradient(120deg,#f43f5e,#fb7185)] px-1 text-[11px] font-bold tabular-nums text-white ring-2 ring-[#315e52]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-notif-panel
          className={cn(
            'notif-panel fixed inset-x-3 top-[76px] z-50 flex max-h-[calc(100dvh-180px)] flex-col overflow-hidden',
            'rounded-[28px] border border-white/70 bg-white/85 backdrop-blur-xl',
            'shadow-[0_40px_90px_-30px_rgba(20,33,29,0.45),inset_0_1px_0_rgba(255,255,255,0.9)]',
            'sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:max-h-[min(640px,calc(100dvh-120px))] sm:w-[408px]',
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(70%_100%_at_30%_0%,rgba(95,168,150,0.18),transparent_70%),radial-gradient(50%_80%_at_90%_0%,rgba(191,240,221,0.35),transparent_70%)]"
          />
          <div className="relative flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold tracking-tight text-zinc-900">Avisos</h3>
              <p className="text-[13px] text-zinc-500">
                {todo.length === 0
                  ? 'Nada pendiente'
                  : `${todo.length} ${todo.length === 1 ? 'cosa por hacer' : 'cosas por hacer'}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {list.length > 1 && (
                <button
                  type="button"
                  onClick={() => void dismiss(list.map((n) => n.ref))}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900"
                >
                  <Check className="h-3.5 w-3.5" />
                  Quitar todo
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar avisos"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition-all hover:bg-zinc-900/5 hover:text-zinc-800 sm:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative shrink-0 px-4 pb-3">
            <div
              className="relative grid rounded-full bg-zinc-900/[0.05] p-1"
              style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
            >
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 rounded-full bg-white shadow-[0_2px_8px_-2px_rgba(20,33,29,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  width: `calc((100% - 8px) / ${tabs.length})`,
                  transform: `translateX(${tabIndex * 100}%)`,
                }}
              />
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={cn(
                    'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] font-medium transition-colors',
                    tab === t.id ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800',
                  )}
                >
                  {t.id === 'mentions' && <AtSign className="h-3 w-3" />}
                  {t.label}
                  {t.count > 0 && (
                    <span
                      className={cn(
                        'inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums',
                        t.id === 'todo' ? 'bg-rose-500 text-white' : 'bg-zinc-900/10 text-zinc-700',
                      )}
                    >
                      {t.count > 9 ? '9+' : t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-zinc-900/[0.06]">
            {tab === 'mentions' ? (
              <MentionsInbox />
            ) : !loaded ? (
              <div className="flex justify-center py-14 text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : list.length === 0 ? (
              <CalmState tab={tab} />
            ) : (
              <ul className="space-y-1.5 p-2.5">
                {list.map((n, i) => (
                  <NoticeRow
                    key={n.ref}
                    notice={n}
                    index={i}
                    fresh={!seen.has(n.ref)}
                    onDismiss={() => void dismiss([n.ref])}
                    onNavigate={onClose}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="relative shrink-0 border-t border-zinc-900/[0.06]">
            <Link
              href={tab === 'activity' ? '/dashboard/calls' : '/dashboard/messages'}
              onClick={onClose}
              className="group flex items-center justify-center gap-1.5 py-3 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-900/[0.03] hover:text-brand-700"
            >
              {tab === 'activity' ? 'Ver todas las llamadas' : 'Abrir el chat del equipo'}
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NoticeRow({
  notice,
  index,
  fresh,
  onDismiss,
  onNavigate,
}: {
  notice: Notice;
  index: number;
  fresh: boolean;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const meta = META[notice.category];
  const Icon = meta.icon;
  const [leaving, setLeaving] = useState(false);
  const [dx, setDx] = useState(0);
  const [task, setTask] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const leave = () => {
    setLeaving(true);
    setTimeout(onDismiss, 260);
  };

  // Deslizar a la izquierda en el móvil la descarta, como en iOS.
  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x;
    if (Math.abs(e.clientY - s.y) > 24 && Math.abs(mx) < 24) {
      start.current = null;
      setDx(0);
      return;
    }
    setDx(Math.min(0, mx));
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (dx < -90) leave();
    else setDx(0);
  };

  async function toTask(messageId: string) {
    setTask('saving');
    try {
      const res = await fetch(`/api/messages/${messageId}/to-task`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      setTask(res.ok ? 'done' : 'error');
    } catch {
      setTask('error');
    }
  }

  return (
    <li
      className={cn('notif-row group relative', leaving && 'notif-leave')}
      style={{ animationDelay: leaving ? undefined : `${Math.min(index * 45, 300)}ms` }}
    >
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          opacity: dx ? Math.max(0.35, 1 + dx / 220) : undefined,
          touchAction: 'pan-y',
        }}
        className={cn(
          'relative rounded-[20px] border px-3.5 py-3 transition-[background-color,border-color,transform,opacity] duration-200',
          fresh
            ? 'border-white bg-white shadow-[0_6px_20px_-12px_rgba(20,33,29,0.35)]'
            : 'border-transparent bg-white/55 hover:bg-white',
          dx === 0 && 'ease-[cubic-bezier(0.22,1,0.36,1)]',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ring-1',
              meta.chip,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 pr-6">
            {notice.href ? (
              <Link
                href={notice.href}
                onClick={onNavigate}
                className="line-clamp-2 text-[14px] font-semibold leading-snug text-zinc-900 hover:text-brand-700"
              >
                {notice.title}
              </Link>
            ) : (
              <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-zinc-900">
                {notice.title}
              </p>
            )}
            {notice.detail && (
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-zinc-500">
                {notice.detail}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-zinc-400">
              {fresh && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
              {notice.category === 'duplicate' || notice.category === 'task'
                ? meta.label
                : `${meta.label} · ${timeAgo(notice.createdAt)}`}
            </p>

            {notice.actions.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {notice.actions.map((a) =>
                  a.kind === 'to-task' ? (
                    <button
                      key="to-task"
                      type="button"
                      disabled={task === 'saving' || task === 'done'}
                      onClick={() => void toTask(a.messageId)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ring-1 transition-all active:scale-95',
                        task === 'done'
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : task === 'error'
                            ? 'bg-rose-50 text-rose-700 ring-rose-200'
                            : 'bg-white text-zinc-700 ring-zinc-200 hover:ring-zinc-300',
                      )}
                    >
                      {task === 'saving' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : task === 'done' ? (
                        <Check className="h-3.5 w-3.5 animate-pop" />
                      ) : (
                        <ListPlus className="h-3.5 w-3.5" />
                      )}
                      {task === 'done' ? 'Tarea creada' : task === 'error' ? 'No se pudo' : a.label}
                    </button>
                  ) : a.kind === 'tel' ? (
                    <a
                      key={a.href}
                      href={a.href}
                      className={actionClass(a.primary)}
                      title={a.href.replace('tel:', '')}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      {a.label}
                    </a>
                  ) : (
                    <Link
                      key={a.href}
                      href={a.href}
                      onClick={onNavigate}
                      className={actionClass(a.primary)}
                    >
                      {a.label}
                    </Link>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={leave}
          aria-label="Quitar aviso"
          title="Quitar"
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-all hover:bg-zinc-900/5 hover:text-zinc-700 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function actionClass(primary?: boolean) {
  return cn(
    'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all active:scale-95',
    primary
      ? 'bg-[linear-gradient(120deg,#37766a,#4f9483)] text-white shadow-[0_6px_14px_-8px_rgba(55,118,106,0.9)] hover:brightness-110'
      : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-300',
  );
}

/** Sin avisos: un orbe de cristal que respira con ondas suaves. */
function CalmState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center px-8 pb-10 pt-9 text-center">
      <div className="relative flex h-28 w-28 items-center justify-center" aria-hidden>
        <span className="notif-ripple absolute inset-0 rounded-full border border-brand-300/60" />
        <span
          className="notif-ripple absolute inset-0 rounded-full border border-brand-300/60"
          style={{ animationDelay: '1.3s' }}
        />
        <span
          className="notif-ripple absolute inset-0 rounded-full border border-brand-300/60"
          style={{ animationDelay: '2.6s' }}
        />
        <span className="notif-orb relative flex h-16 w-16 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#ffffff,#e3f4ee_55%,#bfe3d6)] shadow-[0_18px_40px_-18px_rgba(55,118,106,0.75),inset_0_1px_0_rgba(255,255,255,0.95)] ring-1 ring-white">
          <Bell className="notif-sway h-6 w-6 text-brand-600" strokeWidth={1.8} />
          <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-6 w-6 animate-pop items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_6px_14px_-6px_rgba(16,185,129,0.9)] ring-2 ring-white [animation-delay:350ms]">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        </span>
      </div>
      <p className="mt-5 text-[16px] font-semibold text-zinc-900">Todo en calma</p>
      <p className="mt-1 max-w-[280px] text-[13px] leading-relaxed text-zinc-500">
        {tab === 'todo'
          ? 'Cuando haya que llamar a alguien, una familia pida hablar con vosotras o aparezcan fichas duplicadas, lo verás aquí.'
          : 'Las citas anuladas, las firmas y las llamadas del asistente aparecerán aquí.'}
      </p>
    </div>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'ahora';
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const days = Math.round(hr / 24);
  if (days < 7) return days === 1 ? 'ayer' : `hace ${days} días`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}
