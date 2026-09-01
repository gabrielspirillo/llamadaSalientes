'use client';

import { EventCard } from '@/components/messaging/EventCard';
import {
  type MentionIndex,
  PersonAvatar,
  RichText,
  attachmentUrl,
  formatBytes,
  formatClock,
  isImageAttachment,
} from '@/components/messaging/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { type ImTone, REACTION_EMOJIS } from '@/lib/messaging/constants';
import type { ImAction, ImAttachment, ImMessageDTO } from '@/lib/messaging/types';
import {
  Bookmark,
  CornerDownRight,
  Download,
  FileText,
  MessageSquare,
  Pencil,
  Pin,
  RotateCcw,
  Smile,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/* ============================================================================
   Una fila del hilo. Estilo "equipo" (alineado a la izquierda, con canaleta de
   avatar) y no "chat de mensajería": en un canal de trabajo lo que importa es
   escanear quién dijo qué, no la coreografía de burbujas a los lados.

   Lo propio se tiñe de violeta muy suave para encontrarse de un vistazo.
   ========================================================================== */

export interface MessageBubbleProps {
  message: ImMessageDTO;
  isOwn: boolean;
  /** Continúa al mismo autor: sin avatar ni cabecera, más compacto. */
  grouped: boolean;
  channelTone: ImTone;
  mentions?: MentionIndex;
  currentUserId: string | null;
  senderOnline?: boolean;
  /** Me menciona a mí: se resalta la fila entera. */
  mentionsMe?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  compact?: boolean;
  hideThreadButton?: boolean;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenThread?: (message: ImMessageDTO) => void;
  onEdit?: (message: ImMessageDTO, body: string) => void;
  onDelete?: (message: ImMessageDTO) => void;
  onTogglePin?: (message: ImMessageDTO) => void;
  onToggleSave?: (message: ImMessageDTO) => void;
  onRetry?: (message: ImMessageDTO) => void;
  onAction?: (action: ImAction, message: ImMessageDTO) => Promise<void> | void;
}

export function MessageBubble(props: MessageBubbleProps) {
  const {
    message,
    isOwn,
    grouped,
    channelTone,
    mentions,
    currentUserId,
    senderOnline,
    mentionsMe,
    canEdit,
    canDelete,
    compact,
    hideThreadButton,
    onToggleReaction,
    onOpenThread,
    onEdit,
    onDelete,
    onTogglePin,
    onToggleSave,
    onRetry,
    onAction,
  } = props;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Foco al entrar en modo edición (sin `autoFocus`, que rompe la a11y del SSR).
  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  useEffect(() => {
    if (!emojiOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rowRef.current?.contains(e.target as Node)) setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen]);

  const isSystem = message.senderKind !== 'USER';
  const isEvent = message.kind === 'EVENT';
  const isDecision = message.kind === 'DECISION';
  const deleted = !!message.deletedAt;
  const senderName = message.senderName ?? (isSystem ? 'Futura' : 'Alguien');

  // ── Evento: la tarjeta ocupa el ancho del hilo, sin canaleta de avatar.
  if (isEvent && !deleted) {
    return (
      <li ref={rowRef} className="px-2 py-1.5">
        <EventCard
          message={message}
          channelTone={channelTone}
          mentions={mentions}
          onAction={onAction}
        />
        <ReactionRow
          message={message}
          currentUserId={currentUserId}
          onToggleReaction={onToggleReaction}
          className="mt-1.5 pl-2"
        />
      </li>
    );
  }

  // ── Sistema breve (alguien se sumó, se cambió el tema): línea centrada.
  if (message.kind === 'SYSTEM' && !deleted) {
    return (
      <li className="flex justify-center px-4 py-1.5">
        <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-[14px] text-zinc-500 ring-1 ring-[--color-border-subtle]">
          <Sparkles className="h-3 w-3 shrink-0 text-brand-400" />
          <span className="truncate">{message.body}</span>
        </span>
      </li>
    );
  }

  const saveEdit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== message.body) onEdit?.(message, next);
    else setDraft(message.body);
  };

  return (
    <li
      ref={rowRef}
      data-message-id={message.id}
      className={cn(
        'group relative flex gap-3 rounded-[18px] px-3 transition-colors duration-200',
        grouped ? 'py-0.5' : 'pb-1 pt-2.5',
        mentionsMe ? 'bg-brand-50/60 ring-1 ring-brand-100' : 'hover:bg-white/60',
        message.pending && 'opacity-60',
        !message.pending && 'opacity-100',
        'transition-opacity',
      )}
      style={{ transitionDuration: '200ms' }}
    >
      {/* Canaleta: avatar o la hora al hacer hover sobre un mensaje agrupado */}
      <div className="w-8 shrink-0 pt-0.5">
        {grouped ? (
          <time
            suppressHydrationWarning
            className="hidden select-none text-[12px] font-medium leading-5 text-zinc-400 group-hover:block"
          >
            {formatClock(message.createdAt)}
          </time>
        ) : (
          <PersonAvatar
            name={senderName}
            seed={message.senderUserId ?? senderName}
            size={32}
            online={senderOnline}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
            <span className="text-[16px] font-bold tracking-tight text-zinc-900">{senderName}</span>
            {isSystem && (
              <span className="rounded-md bg-brand-100 px-1.5 py-px text-[11px] font-bold uppercase tracking-[0.1em] text-brand-700">
                {message.senderKind === 'BOT' ? 'bot' : 'sistema'}
              </span>
            )}
            <time suppressHydrationWarning className="text-[13px] font-medium text-zinc-400">
              {formatClock(message.createdAt)}
            </time>
            {message.editedAt && <span className="text-[12px] italic text-zinc-400">editado</span>}
            {message.pinned && (
              <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-amber-600">
                <Pin className="h-2.5 w-2.5" /> fijado
              </span>
            )}
          </div>
        )}

        {deleted ? (
          <p className="text-[16px] italic text-zinc-400">Mensaje eliminado</p>
        ) : editing ? (
          <div className="animate-zoom-in">
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditing(false);
                  setDraft(message.body);
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                }
              }}
              className="w-full rounded-[14px] border border-brand-200 bg-white p-3 text-[16px] leading-relaxed text-zinc-900 focus-visible:border-brand-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/12"
              rows={Math.min(8, draft.split('\n').length + 1)}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button size="xs" onClick={saveEdit}>
                Guardar
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setDraft(message.body);
                }}
              >
                Cancelar
              </Button>
              <span className="text-[13px] text-zinc-400">Esc para cancelar</span>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'relative inline-block max-w-full rounded-[16px] px-3 py-2',
              isDecision
                ? 'border border-brand-200 bg-[linear-gradient(120deg,#f4f1ff,#fdf0f7)] shadow-[var(--shadow-soft)]'
                : isOwn
                  ? 'bg-brand-50/80 ring-1 ring-brand-100'
                  : 'bg-white ring-1 ring-[--color-border-subtle]',
              message.failed && 'ring-2 ring-rose-300',
              compact && 'py-1.5',
            )}
          >
            {isDecision && (
              <p className="mb-1 inline-flex items-center gap-1 text-[12px] font-bold uppercase tracking-[0.12em] text-brand-700">
                <Sparkles className="h-3 w-3" /> Decisión
              </p>
            )}
            <RichText text={message.body} mentions={mentions} className="text-zinc-800" />
            {message.attachments.length > 0 && <AttachmentGrid attachments={message.attachments} />}
            {message.pending && (
              <span
                aria-hidden
                className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-brand-100"
              >
                <span className="skeleton block h-full w-full" />
              </span>
            )}
          </div>
        )}

        {message.failed && (
          <div className="mt-1 flex items-center gap-2 text-[14px] text-rose-600">
            <TriangleAlert className="h-3.5 w-3.5" />
            No se pudo enviar.
            <button
              type="button"
              onClick={() => onRetry?.(message)}
              className="press inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-rose-700"
            >
              <RotateCcw className="h-3 w-3" />
              Reintentar
            </button>
          </div>
        )}

        {!deleted && (
          <ReactionRow
            message={message}
            currentUserId={currentUserId}
            onToggleReaction={onToggleReaction}
            className="mt-1"
          />
        )}

        {!hideThreadButton && message.replyCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenThread?.(message)}
            className="press mt-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[14px] font-semibold text-brand-700 ring-1 ring-brand-100 transition-all duration-300 hover:bg-brand-50 hover:ring-brand-200"
          >
            <MessageSquare className="h-3 w-3" />
            {message.replyCount} {message.replyCount === 1 ? 'respuesta' : 'respuestas'}
            <CornerDownRight className="h-3 w-3 opacity-60" />
          </button>
        )}
      </div>

      {/* Barra de acciones — aparece al pasar el ratón por la fila */}
      {!deleted && !editing && (
        <div
          className={cn(
            'absolute -top-3 right-3 z-10 hidden items-center gap-0.5 rounded-full border border-[--color-border] bg-white/95 p-1 shadow-[var(--shadow-lifted)] backdrop-blur-xl',
            'group-hover:flex group-focus-within:flex',
          )}
        >
          {REACTION_EMOJIS.slice(0, 3).map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggleReaction(message.id, emoji)}
              className="press inline-flex h-7 w-7 items-center justify-center rounded-full text-[18px] transition-transform duration-200 hover:scale-125 hover:bg-brand-50"
              aria-label={`Reaccionar con ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <ToolbarButton
            label="Más reacciones"
            onClick={() => setEmojiOpen((v) => !v)}
            active={emojiOpen}
          >
            <Smile className="h-3.5 w-3.5" />
          </ToolbarButton>
          {!hideThreadButton && (
            <ToolbarButton label="Responder en hilo" onClick={() => onOpenThread?.(message)}>
              <MessageSquare className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
          <ToolbarButton
            label={message.pinned ? 'Quitar de fijados' : 'Fijar en el canal'}
            onClick={() => onTogglePin?.(message)}
            active={message.pinned}
          >
            <Pin className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label={message.saved ? 'Quitar de guardados' : 'Guardar para mí'}
            onClick={() => onToggleSave?.(message)}
            active={message.saved}
          >
            <Bookmark className="h-3.5 w-3.5" />
          </ToolbarButton>
          {canEdit && (
            <ToolbarButton label="Editar" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
          {canDelete && (
            <ToolbarButton label="Eliminar" danger onClick={() => onDelete?.(message)}>
              <Trash2 className="h-3.5 w-3.5" />
            </ToolbarButton>
          )}
        </div>
      )}

      {/* Paleta completa de reacciones */}
      {emojiOpen && (
        <div className="absolute right-3 top-6 z-20 flex animate-zoom-in items-center gap-0.5 rounded-full border border-[--color-border] bg-white p-1.5 shadow-[var(--shadow-lifted)]">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggleReaction(message.id, emoji);
                setEmojiOpen(false);
              }}
              className="press inline-flex h-8 w-8 items-center justify-center rounded-full text-[20px] transition-transform duration-200 hover:scale-125 hover:bg-brand-50"
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setEmojiOpen(false)}
            aria-label="Cerrar"
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function ToolbarButton({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'press inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-200',
        danger
          ? 'text-zinc-400 hover:bg-rose-50 hover:text-rose-600'
          : active
            ? 'bg-brand-100 text-brand-700'
            : 'text-zinc-400 hover:bg-brand-50 hover:text-brand-600',
      )}
    >
      {children}
    </button>
  );
}

/** Píldoras de reacción. Al agregarse entran con `animate-pop`. */
function ReactionRow({
  message,
  currentUserId,
  onToggleReaction,
  className,
}: {
  message: ImMessageDTO;
  currentUserId: string | null;
  onToggleReaction: (messageId: string, emoji: string) => void;
  className?: string;
}) {
  if (message.reactions.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {message.reactions.map((r) => {
        const mine = !!currentUserId && r.userIds.includes(currentUserId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggleReaction(message.id, r.emoji)}
            className={cn(
              'press inline-flex animate-pop items-center gap-1 rounded-full px-2 py-0.5 text-[14px] font-semibold transition-all duration-200',
              mine
                ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300'
                : 'bg-white text-zinc-600 ring-1 ring-[--color-border] hover:ring-brand-200',
            )}
            title={`${r.count} ${r.count === 1 ? 'persona' : 'personas'}`}
          >
            <span className="text-[16px] leading-none">{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function AttachmentGrid({ attachments }: { attachments: ImAttachment[] }) {
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className={cn('grid gap-1.5', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
          {images.map((a) => (
            <a
              key={a.key}
              href={attachmentUrl(a)}
              target="_blank"
              rel="noreferrer"
              className="hover-lift block overflow-hidden rounded-[14px] ring-1 ring-[--color-border]"
            >
              <img
                src={attachmentUrl(a)}
                alt={a.name}
                className="max-h-64 w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}
      {files.map((a) => (
        <a
          key={a.key}
          href={attachmentUrl(a)}
          target="_blank"
          rel="noreferrer"
          className="group/file flex items-center gap-2.5 rounded-[14px] border border-[--color-border] bg-white px-3 py-2 transition-all duration-300 hover:border-brand-200 hover:shadow-[var(--shadow-soft)]"
        >
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <FileText className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-zinc-800">{a.name}</span>
            <span className="block text-[13px] text-zinc-400">{formatBytes(a.size)}</span>
          </span>
          <Download className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors group-hover/file:text-brand-500" />
        </a>
      ))}
    </div>
  );
}
