'use client';

import { useMessaging } from '@/components/messaging/MessagingProvider';
import { EmptyState } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import { AtSign, Check, CornerDownRight } from 'lucide-react';
import Link from 'next/link';

/* ============================================================================
   Bandeja "para mí": menciones sin leer o sin resolver. El estado de leído
   vive en el server (im_mentions.read_at / resolved_at), no en localStorage:
   así sobrevive a cambiar de dispositivo.
   ========================================================================== */

function timeAgo(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
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

export function MentionsInbox({
  onGoToMessage,
  className,
}: {
  /** Si se pasa, "Ir al mensaje" abre el canal acá mismo en vez de navegar. */
  onGoToMessage?: (channelId: string, messageId: string) => void;
  className?: string;
}) {
  const { mentions, resolveMention } = useMessaging();

  if (mentions.length === 0) {
    return (
      <EmptyState
        icon={<AtSign className="h-5 w-5" />}
        title="Nada pendiente para vos"
        description="Cuando alguien te mencione, la mención aparece acá hasta que la resuelvas."
        className={className}
      />
    );
  }

  return (
    <ul
      className={cn('stagger space-y-1.5 p-2', className)}
      style={{ ['--stagger-step' as string]: '40ms' }}
    >
      {mentions.map((m, i) => (
        <li
          key={m.id}
          style={{ ['--i' as string]: i }}
          className="rounded-2xl bg-white p-3 ring-1 ring-[--color-border] transition-shadow hover:shadow-[0_10px_24px_-18px_rgba(23,20,41,0.5)]"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
              <AtSign className="h-3 w-3" />
            </span>
            <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-800">
              {m.senderName ?? 'Sistema'} · {m.channelName}
            </p>
            {!m.readAt && (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
            )}
          </div>

          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-zinc-600">{m.body}</p>
          <p className="mt-1 text-[11px] text-zinc-400">{timeAgo(m.createdAt)}</p>

          <div className="mt-2 flex items-center gap-1.5">
            {onGoToMessage ? (
              <button
                type="button"
                onClick={() => onGoToMessage(m.channelId, m.messageId)}
                className="press inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
              >
                <CornerDownRight className="h-3 w-3" />
                Ir al mensaje
              </button>
            ) : (
              <Link
                href={`/dashboard/messages?channel=${m.channelId}&message=${m.messageId}`}
                className="press inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
              >
                <CornerDownRight className="h-3 w-3" />
                Ir al mensaje
              </Link>
            )}
            <button
              type="button"
              onClick={() => void resolveMention(m.id)}
              className="press inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold text-zinc-500 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Check className="h-3 w-3" />
              Resolver
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
