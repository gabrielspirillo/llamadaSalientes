'use client';

import { useEffect, useMemo, useState } from 'react';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { DockThread } from '@/components/messaging/dock/DockThread';
import { MentionsInbox } from '@/components/messaging/dock/MentionsInbox';
import { QuickSwitcher } from '@/components/messaging/dock/QuickSwitcher';
import { StatusDot } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/feedback';
import { Switch } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  AtSign,
  BellRing,
  Check,
  ChevronDown,
  Hash,
  Maximize2,
  MessageSquare,
  Settings2,
  Volume2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* ============================================================================
   Dock flotante de Mensajes. Presente en todo /dashboard salvo en la página
   completa (/dashboard/messages), donde sobra.

   Colapsado: burbuja con el gradiente de marca y el total de no leídos.
   Expandido: 380 × 560, .glass, selector de canal, hilo compacto y composer.
   Estado persistido en 'futura.dock.open' y 'futura.dock.channel'.
   ========================================================================== */

type DockView = 'thread' | 'mentions' | 'settings';

export function MessagesDock() {
  const {
    ready,
    channels,
    totalUnread,
    totalMentions,
    dockOpen,
    setDockOpen,
    activeChannelId,
    openChannel,
    mentions,
    notifications,
  } = useMessaging();

  const pathname = usePathname();
  const hidden = pathname.startsWith('/dashboard/messages');

  const [view, setView] = useState<DockView>('thread');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Canales por recencia; el activo es el guardado o el primero con pendientes.
  const ordered = useMemo(
    () =>
      [...channels]
        .filter((c) => !c.archived)
        .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')),
    [channels],
  );

  const current = useMemo(() => {
    if (activeChannelId) {
      const found = ordered.find((c) => c.id === activeChannelId);
      if (found) return found;
    }
    return ordered.find((c) => c.unreadCount > 0) ?? ordered[0] ?? null;
  }, [ordered, activeChannelId]);

  // Escape cierra: primero el selector, después el panel.
  useEffect(() => {
    if (!dockOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      setDockOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dockOpen, pickerOpen, setDockOpen]);

  // Clic fuera del selector de canal.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dock-picker]')) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [pickerOpen]);

  // El módulo todavía no está disponible (migración sin aplicar, sin permisos):
  // no dibujamos nada. El resto del panel sigue funcionando igual.
  if (!ready) return null;

  if (hidden) {
    // En la página completa el dock sobra, pero ⌘J tiene que seguir vivo.
    return <QuickSwitcher />;
  }

  return (
    <>
      <QuickSwitcher />

      {/* --- Burbuja colapsada -------------------------------------------- */}
      {!dockOpen && (
        <button
          type="button"
          onClick={() => setDockOpen(true)}
          aria-label={totalUnread > 0 ? `Mensajes, ${totalUnread} sin leer` : 'Mensajes del equipo'}
          className={cn(
            'press fixed bottom-5 right-4 z-[60] inline-flex h-14 w-14 animate-fade-up items-center justify-center rounded-full',
            'bg-[linear-gradient(135deg,#2e5f56,#479183_60%,#6bc2a4)] text-white',
            'shadow-[0_18px_38px_-14px_rgba(55,118,106,0.85)] transition-transform duration-300 hover:scale-105 sm:right-6',
            totalMentions > 0 && 'animate-pulse-ring',
          )}
        >
          <MessageSquare className="h-5 w-5" />
          {totalUnread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[linear-gradient(120deg,#f43f5e,#fb7185)] px-1 text-[12px] font-bold tabular-nums text-white ring-2 ring-white">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}

      {/* --- Panel expandido ----------------------------------------------- */}
      {dockOpen && (
        <section
          className={cn(
            'glass fixed bottom-5 right-4 z-[60] flex animate-fade-up flex-col overflow-hidden rounded-[22px] sm:right-6',
            'h-[560px] max-h-[calc(100vh-2.5rem)] w-[380px] max-w-[calc(100vw-2rem)]',
            'shadow-[0_40px_90px_-30px_rgba(22,26,25,0.55)]',
          )}
          aria-label="Mensajes del equipo"
        >
          {/* Cabecera */}
          <div className="relative shrink-0 border-b border-white/60 bg-white/70 px-3 py-2.5">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(95,168,150,0.14),transparent_70%)]"
            />
            <div className="relative flex items-center gap-1.5">
              {/* Selector de canal */}
              <div className="relative min-w-0 flex-1" data-dock-picker>
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                    {current?.kind === 'DM' ? (
                      <MessageSquare className="h-3.5 w-3.5" />
                    ) : (
                      <Hash className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-bold tracking-tight text-zinc-900">
                      {current?.name ?? 'Mensajes'}
                    </span>
                    <span className="block truncate text-[12px] text-zinc-400">
                      {totalUnread > 0 ? `${totalUnread} sin leer` : 'Al día'}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform duration-300',
                      pickerOpen && 'rotate-180',
                    )}
                  />
                </button>

                {pickerOpen && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[280px] animate-fade-down overflow-y-auto rounded-2xl border border-white/60 bg-white p-1.5 shadow-[0_30px_70px_-30px_rgba(22,26,25,0.5)]">
                    {ordered.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[14px] text-zinc-400">
                        Todavía no hay canales.
                      </p>
                    ) : (
                      <ul
                        className="stagger space-y-0.5"
                        style={{ ['--stagger-step' as string]: '25ms' }}
                      >
                        {ordered.map((c, i) => (
                          <li key={c.id} style={{ ['--i' as string]: i }}>
                            <button
                              type="button"
                              onClick={() => {
                                openChannel(c.id);
                                setView('thread');
                                setPickerOpen(false);
                              }}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                                c.id === current?.id ? 'bg-brand-50' : 'hover:bg-brand-50/60',
                              )}
                            >
                              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 ring-1 ring-[--color-border]">
                                {c.kind === 'DM' ? (
                                  <MessageSquare className="h-3 w-3" />
                                ) : (
                                  <Hash className="h-3 w-3" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-zinc-800">
                                {c.name}
                              </span>
                              {c.mentionCount > 0 && <StatusDot tone="danger" />}
                              {c.unreadCount > 0 && (
                                <span className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-white">
                                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* Acciones */}
              <DockIconButton
                label="Menciones para mí"
                active={view === 'mentions'}
                onClick={() => setView((v) => (v === 'mentions' ? 'thread' : 'mentions'))}
                badge={mentions.length}
              >
                <AtSign className="h-4 w-4" />
              </DockIconButton>
              <DockIconButton
                label="Avisos"
                active={view === 'settings'}
                onClick={() => setView((v) => (v === 'settings' ? 'thread' : 'settings'))}
              >
                <Settings2 className="h-4 w-4" />
              </DockIconButton>
              <Link
                href={current ? `/dashboard/messages?channel=${current.id}` : '/dashboard/messages'}
                title="Abrir pantalla completa"
                aria-label="Abrir pantalla completa"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900"
              >
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setDockOpen(false)}
                aria-label="Cerrar mensajes"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-all hover:rotate-90 hover:bg-white hover:text-zinc-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Cuerpo */}
          {view === 'mentions' ? (
            <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
              <MentionsInbox
                onGoToMessage={(channelId) => {
                  openChannel(channelId);
                  setView('thread');
                }}
              />
            </div>
          ) : view === 'settings' ? (
            <DockSettings notifications={notifications} />
          ) : current ? (
            <DockThread key={current.id} channelId={current.id} />
          ) : (
            <EmptyState
              icon={<MessageSquare className="h-5 w-5" />}
              title="Sin canales todavía"
              description="Entrá a Mensajes una vez y se crean los canales del equipo."
              action={
                <Link
                  href="/dashboard/messages"
                  className="press inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-4 py-2 text-[14px] font-semibold text-white"
                >
                  Abrir Mensajes
                </Link>
              }
            />
          )}
        </section>
      )}
    </>
  );
}

function DockIconButton({
  children,
  label,
  active,
  onClick,
  badge = 0,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors',
        active ? 'bg-brand-50 text-brand-700' : 'text-zinc-500 hover:bg-white hover:text-zinc-900',
      )}
    >
      {children}
      {badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
      )}
    </button>
  );
}

/** Preferencias de aviso. La escalera de §9, silenciable de arriba a abajo. */
function DockSettings({
  notifications,
}: {
  notifications: ReturnType<typeof useMessaging>['notifications'];
}) {
  const {
    soundEnabled,
    setSoundEnabled,
    toastsEnabled,
    setToastsEnabled,
    desktopPermission,
    requestDesktopPermission,
  } = notifications;

  return (
    <div className="scrollbar-none min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      <p className="px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-zinc-400">Avisos</p>

      <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-[--color-border]">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
          <Volume2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-zinc-800">Sonido</span>
          <span className="block text-[13px] text-zinc-500">
            Un tono corto en menciones y mensajes directos.
          </span>
        </span>
        <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} label="Sonido" />
      </div>

      <div className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-[--color-border]">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
          <BellRing className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold text-zinc-800">Avisos en pantalla</span>
          <span className="block text-[13px] text-zinc-500">
            Tarjeta en la esquina que enlaza al hilo.
          </span>
        </span>
        <Switch checked={toastsEnabled} onCheckedChange={setToastsEnabled} label="Avisos" />
      </div>

      <div className="rounded-2xl bg-white p-3 ring-1 ring-[--color-border]">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
            <MessageSquare className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-zinc-800">
              Notificaciones del navegador
            </span>
            <span className="block text-[13px] text-zinc-500">
              Solo el nombre y el canal: nunca datos del paciente.
            </span>
          </span>
        </div>
        <div className="mt-2.5">
          {desktopPermission === 'granted' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700">
              <Check className="h-3 w-3" />
              Activadas
            </span>
          ) : desktopPermission === 'denied' ? (
            <p className="text-[13px] text-zinc-500">
              Están bloqueadas en el navegador. Se reactivan desde los permisos del sitio.
            </p>
          ) : desktopPermission === 'unsupported' ? (
            <p className="text-[13px] text-zinc-500">Este navegador no las soporta.</p>
          ) : (
            <button
              type="button"
              onClick={requestDesktopPermission}
              className="press inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(55,118,106,0.9)]"
            >
              Activar notificaciones
            </button>
          )}
        </div>
      </div>

      <p className="px-1 pt-1 text-[13px] leading-relaxed text-zinc-400">
        El contador del título de la pestaña y el badge del menú están siempre activos: son los
        avisos que no interrumpen.
      </p>
    </div>
  );
}
