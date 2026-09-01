'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InputWithIcon } from '@/components/ui/input';
import { Equalizer } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import type { ImChannelDTO, ImPerson, ImPresence } from '@/lib/messaging/types';
import { Plus, Search, Sparkles, WifiOff, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  ACTIVE_BAR,
  PersonAvatar,
  channelIcon,
  plainPreview,
  timeAgo,
  toneMeta,
} from '@/components/messaging/shared';

/* ============================================================================
   Columna izquierda: buscar, fijados, canales, hilos de contexto y directos.
   El ítem activo lleva la misma barra de acento que el NavLink del sidebar,
   para que el rail se lea como una extensión de la navegación y no como otra
   aplicación metida dentro.
   ========================================================================== */

export function ChannelRail({
  channels,
  people,
  presence,
  me,
  activeId,
  totalUnread,
  connected,
  onSelect,
  onStartDm,
  onNewChannel,
  className,
}: {
  channels: ImChannelDTO[];
  people: ImPerson[];
  presence: Map<string, ImPresence>;
  me: ImPerson | null;
  activeId: string | null;
  totalUnread: number;
  connected: boolean;
  onSelect: (channelId: string) => void;
  onStartDm: (userId: string) => void;
  /** Abre el diálogo de crear canal. Sin esto no había forma de crear ninguno. */
  onNewChannel?: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [showPeople, setShowPeople] = useState(false);

  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = channels.filter((c) => !c.archived);
    const match = (c: ImChannelDTO) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.topic ?? '').toLowerCase().includes(q) ||
      (c.contextLabel ?? '').toLowerCase().includes(q);

    const filtered = visible.filter(match);
    return {
      pinned: filtered.filter((c) => c.pinned),
      rooms: filtered.filter(
        (c) => !c.pinned && (c.kind === 'PUBLIC' || c.kind === 'PRIVATE' || c.kind === 'GROUP'),
      ),
      contexts: filtered.filter((c) => !c.pinned && c.kind === 'CONTEXT'),
      dms: filtered.filter((c) => !c.pinned && c.kind === 'DM'),
    };
  }, [channels, q]);

  // Gente del equipo con la que todavía no hay DM abierto: un clic lo crea.
  const availablePeople = useMemo(() => {
    const withDm = new Set(
      channels.filter((c) => c.kind === 'DM').map((c) => c.counterpartUserId ?? ''),
    );
    return people
      .filter((p) => p.userId !== me?.userId && !withDm.has(p.userId))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  }, [channels, people, me, q]);

  const empty =
    groups.pinned.length === 0 &&
    groups.rooms.length === 0 &&
    groups.contexts.length === 0 &&
    groups.dms.length === 0;

  return (
    <Card tone="glass" className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      {/* Cabecera: buscador + estado de la conexión en vivo */}
      <div className="shrink-0 border-b border-white/60 p-3">
        <InputWithIcon
          icon={<Search className="h-4 w-4" />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar canal o persona"
          aria-label="Buscar canal o persona"
          className="h-10 bg-white/80 text-[14px]"
          trailing={
            query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpiar búsqueda"
                className="pointer-events-auto rounded-full p-0.5 text-zinc-400 transition-colors hover:text-zinc-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        />
        <div className="mt-2.5 flex items-center justify-between px-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400">
            {connected ? (
              <>
                <Equalizer className="text-emerald-500" />
                En vivo
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-amber-500" />
                Reconectando
              </>
            )}
          </span>
          {totalUnread > 0 && (
            <Badge tone="brand" size="sm">
              {totalUnread} sin leer
            </Badge>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {empty && availablePeople.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[14px] text-zinc-500">
              {q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay canales.'}
            </p>
            {!q && onNewChannel && (
              <Button size="sm" variant="soft" className="mt-3" onClick={onNewChannel}>
                <Plus className="h-3.5 w-3.5" />
                Crear el primero
              </Button>
            )}
          </div>
        ) : null}

        {groups.pinned.length > 0 && (
          <RailSection title="Fijados">
            {groups.pinned.map((c, i) => (
              <RailChannel
                key={c.id}
                channel={c}
                index={i}
                active={c.id === activeId}
                presence={presence}
                onSelect={onSelect}
              />
            ))}
          </RailSection>
        )}

        {groups.rooms.length > 0 && (
          <RailSection
            title="Canales"
            action={
              onNewChannel ? (
                <button
                  type="button"
                  onClick={onNewChannel}
                  aria-label="Crear un canal"
                  title="Crear un canal"
                  className="press inline-flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : undefined
            }
          >
            {groups.rooms.map((c, i) => (
              <RailChannel
                key={c.id}
                channel={c}
                index={i}
                active={c.id === activeId}
                presence={presence}
                onSelect={onSelect}
              />
            ))}
          </RailSection>
        )}

        {groups.contexts.length > 0 && (
          <RailSection title="Hilos de contexto">
            {groups.contexts.map((c, i) => (
              <RailChannel
                key={c.id}
                channel={c}
                index={i}
                active={c.id === activeId}
                presence={presence}
                onSelect={onSelect}
              />
            ))}
          </RailSection>
        )}

        {(groups.dms.length > 0 || availablePeople.length > 0) && (
          <RailSection
            title="Directos"
            action={
              availablePeople.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowPeople((v) => !v)}
                  className="press inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label={showPeople ? 'Ocultar equipo' : 'Escribir a alguien del equipo'}
                  title={showPeople ? 'Ocultar equipo' : 'Escribir a alguien del equipo'}
                >
                  {showPeople ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                </button>
              ) : undefined
            }
          >
            {groups.dms.map((c, i) => (
              <RailChannel
                key={c.id}
                channel={c}
                index={i}
                active={c.id === activeId}
                presence={presence}
                onSelect={onSelect}
              />
            ))}

            {(showPeople || (groups.dms.length === 0 && !!q)) &&
              availablePeople.map((p, i) => (
                <li key={p.userId} style={{ ['--i' as string]: i }}>
                  <button
                    type="button"
                    onClick={() => onStartDm(p.userId)}
                    className="group flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left transition-colors duration-200 hover:bg-white/80"
                  >
                    <PersonAvatar
                      name={p.name}
                      seed={p.userId}
                      size={26}
                      online={presence.get(p.userId)?.online}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] text-zinc-500 group-hover:text-zinc-800">
                      {p.name}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors group-hover:text-brand-500" />
                  </button>
                </li>
              ))}
          </RailSection>
        )}
      </div>
    </Card>
  );
}

function RailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-3">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">
          <span className="h-2.5 w-1 rounded-full bg-[linear-gradient(180deg,#37766a,#6bc2a4)]" />
          {title}
        </h3>
        {action}
      </div>
      <ul className="stagger space-y-0.5">{children}</ul>
    </section>
  );
}

function RailChannel({
  channel,
  index,
  active,
  presence,
  onSelect,
}: {
  channel: ImChannelDTO;
  index: number;
  active: boolean;
  presence: Map<string, ImPresence>;
  onSelect: (id: string) => void;
}) {
  const Icon = channelIcon(channel);
  const tone = toneMeta(channel.tone);
  const unread = channel.unreadCount > 0;
  const isDm = channel.kind === 'DM';
  const online =
    isDm && channel.counterpartUserId
      ? (presence.get(channel.counterpartUserId)?.online ?? false)
      : false;

  return (
    <li style={{ ['--i' as string]: index }}>
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'group relative flex w-full items-center gap-2.5 rounded-[14px] px-2.5 py-2 text-left',
          'transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          active ? 'bg-white shadow-[var(--shadow-soft)]' : 'hover:bg-white/70',
        )}
      >
        {/* Barra de acento del ítem activo */}
        <span
          aria-hidden
          className={cn(
            'absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-300',
            active ? cn(ACTIVE_BAR, 'opacity-100') : 'opacity-0',
          )}
        />

        {isDm ? (
          <PersonAvatar
            name={channel.name}
            seed={channel.counterpartUserId ?? channel.id}
            size={26}
            online={online}
          />
        ) : (
          <span
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] transition-transform duration-300 group-hover:scale-110',
              tone.chip,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[14px] leading-tight',
                unread
                  ? 'font-bold text-zinc-900'
                  : active
                    ? 'font-semibold text-zinc-900'
                    : 'font-medium text-zinc-600',
              )}
            >
              {channel.name}
            </span>
            {channel.lastMessageAt && (
              <time
                suppressHydrationWarning
                className="shrink-0 text-[11px] font-medium text-zinc-400"
              >
                {timeAgo(channel.lastMessageAt)}
              </time>
            )}
          </span>
          {channel.lastMessagePreview && (
            <span
              className={cn(
                'mt-0.5 block truncate text-[13px] leading-tight',
                unread ? 'text-zinc-600' : 'text-zinc-400',
              )}
            >
              {plainPreview(channel.lastMessagePreview, 44)}
            </span>
          )}
        </span>

        {channel.mentionCount > 0 ? (
          <Badge tone="brand" size="sm" className="shrink-0 animate-pop">
            @{channel.mentionCount}
          </Badge>
        ) : unread ? (
          <span className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold tabular-nums text-white shadow-[0_4px_12px_-4px_rgba(55,118,106,0.6)]">
            {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
          </span>
        ) : channel.muted ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-200" />
        ) : channel.kind === 'CONTEXT' ? (
          <Sparkles className="h-3 w-3 shrink-0 text-zinc-300" />
        ) : null}
      </button>
    </li>
  );
}
