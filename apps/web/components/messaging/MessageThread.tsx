'use client';

import { MessageBubble } from '@/components/messaging/MessageBubble';
import {
  type MentionIndex,
  TypingDots,
  channelIcon,
  dayKey,
  formatDayDivider,
  toneMeta,
  typingLabel,
} from '@/components/messaging/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, SkeletonRows } from '@/components/ui/feedback';
import { AvatarStack } from '@/components/ui/stat';
import { cn } from '@/lib/cn';
import { EDIT_WINDOW_MS } from '@/lib/messaging/constants';
import type {
  ImAction,
  ImChannelDTO,
  ImMessageDTO,
  ImPerson,
  ImPresence,
} from '@/lib/messaging/types';
import {
  ArrowDown,
  ChevronLeft,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ============================================================================
   Columna central: cabecera del canal, hilo con scroll infinito hacia arriba y
   composer al pie.

   Reglas de scroll (lo que separa un chat que se siente instantáneo de uno que
   pelea contigo):
   · Solo autoscrolleamos si estabas pegado al fondo.
   · Si estabas leyendo historial, aparece un botón flotante "nuevos mensajes".
   · Al paginar hacia arriba se preserva la posición exacta de lectura.
   ========================================================================== */

const STICK_THRESHOLD_PX = 90;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function MessageThread({
  channel,
  messages,
  people,
  presence,
  mentions,
  currentUserId,
  loading,
  loadingMore,
  hasMore,
  firstUnreadId,
  typingNames,
  connected,
  contextOpen,
  composer,
  onLoadMore,
  onToggleReaction,
  onOpenThread,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleSave,
  onRetry,
  onAction,
  onDropFiles,
  onBack,
  onToggleContext,
  className,
}: {
  channel: ImChannelDTO | null;
  messages: ImMessageDTO[];
  people: ImPerson[];
  presence: Map<string, ImPresence>;
  mentions: MentionIndex;
  currentUserId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  firstUnreadId: string | null;
  typingNames: string[];
  connected: boolean;
  contextOpen: boolean;
  composer: React.ReactNode;
  onLoadMore: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenThread: (message: ImMessageDTO) => void;
  onEdit: (message: ImMessageDTO, body: string) => void;
  onDelete: (message: ImMessageDTO) => void;
  onTogglePin: (message: ImMessageDTO) => void;
  onToggleSave: (message: ImMessageDTO) => void;
  onRetry: (message: ImMessageDTO) => void;
  onAction: (action: ImAction, message: ImMessageDTO) => Promise<void> | void;
  onDropFiles: (files: File[]) => void;
  onBack: () => void;
  onToggleContext: () => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Altura del scroll ANTES de prepender una página vieja; se usa para dejar
  // el ojo del lector exactamente donde estaba.
  const restoreRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const channelIdRef = useRef<string | null>(null);

  const [showJump, setShowJump] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const scrollToBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    stickToBottomRef.current = true;
    setShowJump(false);
  }, []);

  // Cambio de canal: siempre al fondo, sin animación.
  useLayoutEffect(() => {
    if (channel?.id !== channelIdRef.current) {
      channelIdRef.current = channel?.id ?? null;
      stickToBottomRef.current = true;
      restoreRef.current = null;
      lastIdRef.current = null;
      setShowJump(false);
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }, [channel?.id, scrollToBottom]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Paginación hacia arriba: recuperamos la posición de lectura.
    if (restoreRef.current != null) {
      const delta = el.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      el.scrollTop = el.scrollTop + delta;
      return;
    }

    const last = messages.at(-1);
    const isNew = !!last && last.id !== lastIdRef.current;
    lastIdRef.current = last?.id ?? null;

    if (stickToBottomRef.current) {
      scrollToBottom(false);
    } else if (isNew) {
      setShowJump(true);
    }
  }, [messages, scrollToBottom]);

  // El indicador de escritura también empuja el hilo si estabas al fondo.
  useEffect(() => {
    if (typingNames.length > 0 && stickToBottomRef.current) scrollToBottom(false);
  }, [typingNames.length, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < STICK_THRESHOLD_PX;
    if (stickToBottomRef.current) setShowJump(false);

    if (el.scrollTop < 120 && hasMore && !loadingMore) {
      restoreRef.current = el.scrollHeight;
      onLoadMore();
    }
  };

  if (!channel) {
    return (
      <Card className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
        <EmptyState
          icon={<MessageSquare className="h-6 w-6" />}
          title="Elige un canal"
          description="Las conversaciones del equipo, los avisos del sistema y los hilos de cada paciente están aquí."
        />
      </Card>
    );
  }

  const tone = toneMeta(channel.tone);
  const Icon = channelIcon(channel);
  const memberNames = channel.memberIds
    .map((id) => people.find((p) => p.userId === id)?.name)
    .filter((n): n is string => !!n);
  const onlineCount = channel.memberIds.filter((id) => presence.get(id)?.online).length;

  return (
    <Card
      className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', className)}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        onDropFiles(files);
      }}
    >
      {/* Cabecera */}
      <header className="relative flex shrink-0 items-center gap-3 border-b border-[--color-border-subtle] bg-[linear-gradient(180deg,#ffffff,#fbfcfc)] px-3 py-3 sm:px-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(70%_140%_at_0%_0%,rgba(95,168,150,0.10),transparent_65%)]"
        />

        <button
          type="button"
          onClick={onBack}
          aria-label="Volver a los canales"
          className="press relative inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 lg:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <span className="relative inline-flex shrink-0">
          <span
            className={cn(
              'inline-flex h-11 w-11 items-center justify-center rounded-[15px] shadow-[0_10px_24px_-16px_rgba(22,26,25,0.6)]',
              tone.chip,
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
          {connected && (
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white"
            />
          )}
        </span>

        <div className="relative min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-bold tracking-tight text-zinc-900">
            {channel.name}
          </h2>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-zinc-500">
            {onlineCount > 0 && (
              <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {onlineCount} en línea
              </span>
            )}
            {onlineCount > 0 && <span className="text-zinc-300">·</span>}
            <span className="truncate">
              {channel.topic ??
                channel.contextLabel ??
                `${channel.memberIds.length} ${channel.memberIds.length === 1 ? 'persona' : 'personas'}`}
            </span>
          </p>
        </div>

        {memberNames.length > 0 && (
          <AvatarStack names={memberNames} max={4} size={28} className="relative hidden sm:flex" />
        )}

        {!connected && (
          <span className="relative hidden items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200/70 sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            Reconectando
          </span>
        )}

        <div className="relative flex shrink-0 items-center gap-0.5 rounded-full bg-white/80 p-1 ring-1 ring-[--color-border-subtle]">
          <button
            type="button"
            onClick={onToggleContext}
            aria-label={contextOpen ? 'Ocultar el panel del canal' : 'Ver el panel del canal'}
            title={contextOpen ? 'Ocultar el panel del canal' : 'Ver el panel del canal'}
            className={cn(
              'press inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              contextOpen
                ? 'bg-brand-100 text-brand-700'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700',
            )}
          >
            {contextOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Hilo */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="thread-canvas relative min-h-0 flex-1 overflow-y-auto px-1 py-3 sm:px-2"
      >
        {loading ? (
          <SkeletonRows rows={6} />
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-6 w-6" />}
            title={`Todavía no ha escrito nadie en ${channel.name}`}
            description={
              channel.topic ??
              'Cuenta qué ha pasado, arrastra un archivo o menciona a alguien con @ para empezar.'
            }
          />
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button
                  variant="soft"
                  size="xs"
                  onClick={() => {
                    const el = scrollRef.current;
                    if (el) restoreRef.current = el.scrollHeight;
                    onLoadMore();
                  }}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Cargando…' : 'Ver mensajes anteriores'}
                </Button>
              </div>
            )}

            <ul className="space-y-0">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const grouped =
                  !!prev &&
                  prev.kind === 'TEXT' &&
                  m.kind === 'TEXT' &&
                  prev.senderUserId === m.senderUserId &&
                  prev.senderKind === m.senderKind &&
                  !prev.deletedAt &&
                  dayKey(prev.createdAt) === dayKey(m.createdAt) &&
                  new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                    GROUP_WINDOW_MS;

                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                const isOwn = !!currentUserId && m.senderUserId === currentUserId;
                const age = Date.now() - new Date(m.createdAt).getTime();

                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <li className="my-3 flex items-center gap-3 px-4">
                        <span className="h-px flex-1 bg-[--color-border]" />
                        <span className="rounded-full bg-white px-3 py-0.5 text-[12px] font-bold uppercase tracking-[0.1em] text-zinc-400 ring-1 ring-[--color-border]">
                          {formatDayDivider(m.createdAt)}
                        </span>
                        <span className="h-px flex-1 bg-[--color-border]" />
                      </li>
                    )}

                    {firstUnreadId === m.id && (
                      <li className="my-2 flex items-center gap-3 px-4">
                        <span className="animate-grow-x h-px flex-1 origin-left bg-[linear-gradient(90deg,transparent,#f43f5e)]" />
                        <span className="animate-pop rounded-full bg-rose-500 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_6px_18px_-8px_rgba(244,63,94,0.9)]">
                          Mensajes nuevos
                        </span>
                        <span className="animate-grow-x h-px flex-1 origin-right bg-[linear-gradient(90deg,#f43f5e,transparent)]" />
                      </li>
                    )}

                    <MessageBubble
                      message={m}
                      isOwn={isOwn}
                      grouped={grouped && !newDay && firstUnreadId !== m.id}
                      channelTone={channel.tone}
                      mentions={mentions}
                      currentUserId={currentUserId}
                      senderOnline={
                        m.senderUserId ? presence.get(m.senderUserId)?.online : undefined
                      }
                      mentionsMe={
                        (!!currentUserId && m.mentions.includes(currentUserId)) ||
                        m.mentionsEveryone
                      }
                      canEdit={isOwn && !m.deletedAt && age < EDIT_WINDOW_MS && !m.pending}
                      canDelete={isOwn && !m.deletedAt && !m.pending}
                      onToggleReaction={onToggleReaction}
                      onOpenThread={onOpenThread}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onTogglePin={onTogglePin}
                      onToggleSave={onToggleSave}
                      onRetry={onRetry}
                      onAction={onAction}
                    />
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}

        {typingNames.length > 0 && (
          <div className="flex animate-fade-up items-center gap-2 px-4 py-2">
            <AvatarStack names={typingNames} max={3} size={22} />
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-600 shadow-[var(--shadow-soft)] ring-1 ring-[--color-border-subtle]">
              <TypingDots />
              {typingLabel(typingNames)}
            </span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Botón flotante: llegaron mensajes mientras leías historial */}
      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="press absolute bottom-28 left-1/2 z-20 inline-flex -translate-x-1/2 animate-fade-up items-center gap-1.5 rounded-full bg-[linear-gradient(120deg,#37766a,#5fa896)] px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_10px_30px_-8px_rgba(55,118,106,0.75)]"
        >
          Nuevos mensajes
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Composer */}
      <div className="shrink-0 border-t border-[--color-border-subtle] bg-white/70 p-3 backdrop-blur-xl">
        {composer}
      </div>

      {/* Overlay de arrastrar y soltar */}
      {dragging && (
        <div className="spotlight pointer-events-none absolute inset-2 z-30 flex animate-fade-in items-center justify-center rounded-[20px] border-2 border-dashed border-brand-400 bg-white/80 backdrop-blur-sm">
          <div className="text-center">
            <span className="mx-auto mb-3 inline-flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#e7f5ef,#ddf3ea)] text-brand-700">
              <Paperclip className="h-6 w-6" />
            </span>
            <p className="text-[16px] font-semibold text-zinc-800">Suelta para adjuntar</p>
            <p className="mt-1 text-[14px] text-zinc-500">Se sube y se envía con tu mensaje</p>
          </div>
        </div>
      )}
    </Card>
  );
}
