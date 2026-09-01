'use client';

import { Composer } from '@/components/messaging/Composer';
import { MessageBubble } from '@/components/messaging/MessageBubble';
import { type MentionIndex, TypingDots, toneMeta } from '@/components/messaging/shared';
import { SkeletonRows } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { EDIT_WINDOW_MS } from '@/lib/messaging/constants';
import type {
  ImAction,
  ImAttachment,
  ImChannelDTO,
  ImMessageDTO,
  ImPerson,
  ImPresence,
} from '@/lib/messaging/types';
import { MessageSquare, X } from 'lucide-react';
import { useEffect } from 'react';

/* ============================================================================
   Respuestas en hilo: panel lateral deslizante, no una página nueva. Mantener
   el canal a la vista es justamente el motivo de responder en hilo.
   ========================================================================== */

export function ThreadPanel({
  open,
  parent,
  replies,
  channel,
  people,
  presence,
  mentions,
  currentUserId,
  loading,
  onClose,
  onSend,
  onTyping,
  onToggleReaction,
  onEdit,
  onDelete,
  onTogglePin,
  onToggleSave,
  onRetry,
  onAction,
}: {
  open: boolean;
  parent: ImMessageDTO | null;
  replies: ImMessageDTO[];
  channel: ImChannelDTO | null;
  people: ImPerson[];
  presence: Map<string, ImPresence>;
  mentions: MentionIndex;
  currentUserId: string | null;
  loading: boolean;
  onClose: () => void;
  onSend: (body: string, attachments: ImAttachment[]) => void;
  onTyping: () => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onEdit: (message: ImMessageDTO, body: string) => void;
  onDelete: (message: ImMessageDTO) => void;
  onTogglePin: (message: ImMessageDTO) => void;
  onToggleSave: (message: ImMessageDTO) => void;
  onRetry: (message: ImMessageDTO) => void;
  onAction: (action: ImAction, message: ImMessageDTO) => Promise<void> | void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !parent || !channel) return null;

  const tone = toneMeta(channel.tone);

  const renderRow = (m: ImMessageDTO, isParent: boolean) => {
    const isOwn = !!currentUserId && m.senderUserId === currentUserId;
    const age = Date.now() - new Date(m.createdAt).getTime();
    return (
      <MessageBubble
        key={m.id}
        message={m}
        isOwn={isOwn}
        grouped={false}
        compact
        hideThreadButton
        channelTone={channel.tone}
        mentions={mentions}
        currentUserId={currentUserId}
        senderOnline={m.senderUserId ? presence.get(m.senderUserId)?.online : undefined}
        mentionsMe={(!!currentUserId && m.mentions.includes(currentUserId)) || m.mentionsEveryone}
        canEdit={isOwn && !m.deletedAt && age < EDIT_WINDOW_MS && !m.pending}
        canDelete={isOwn && !m.deletedAt && !m.pending && !isParent}
        onToggleReaction={onToggleReaction}
        onEdit={onEdit}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
        onToggleSave={onToggleSave}
        onRetry={onRetry}
        onAction={onAction}
      />
    );
  };

  return (
    <>
      {/* Velo: en escritorio deja ver el canal detrás, en móvil lo tapa */}
      <button
        type="button"
        aria-label="Cerrar hilo"
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fade-in cursor-default bg-[#171429]/25 backdrop-blur-[2px]"
      />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] animate-slide-right flex-col border-l border-white/60 bg-white shadow-[0_40px_90px_-30px_rgba(22,26,25,0.5)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-[--color-border-subtle] px-4 py-3.5">
          <span
            className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl', tone.chip)}
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold tracking-tight text-zinc-900">Hilo</h2>
            <p className="truncate text-[13px] text-zinc-500">en {channel.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar hilo"
            className="press inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-all duration-300 hover:rotate-90 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbfaff_0%,#f8f7fd_100%)] px-1 py-3">
          <ul className="space-y-0">{renderRow(parent, true)}</ul>

          <div className="my-3 flex items-center gap-3 px-4">
            <span className="h-px flex-1 bg-[--color-border]" />
            <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-500">
              {replies.length === 0
                ? 'Sin respuestas'
                : `${replies.length} ${replies.length === 1 ? 'respuesta' : 'respuestas'}`}
            </span>
            <span className="h-px flex-1 bg-[--color-border]" />
          </div>

          {loading ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="space-y-0">{replies.map((r) => renderRow(r, false))}</ul>
          )}

          {loading && (
            <div className="flex items-center gap-2 px-5 py-2">
              <TypingDots />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[--color-border-subtle] bg-white/70 p-3 backdrop-blur-xl">
          <Composer
            compact
            channelName="el hilo"
            placeholder="Responder en el hilo…"
            people={people}
            mentions={mentions}
            currentUserId={currentUserId}
            resetKey={parent.id}
            onSend={onSend}
            onTyping={onTyping}
          />
        </div>
      </aside>
    </>
  );
}
