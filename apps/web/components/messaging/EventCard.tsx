'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { ImTone } from '@/lib/messaging/constants';
import type { ImAction, ImMessageDTO } from '@/lib/messaging/types';
import { Check, ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  type MentionIndex,
  RichText,
  eventIcon,
  eventLabel,
  eventTone,
  formatClock,
  toneMeta,
} from '@/components/messaging/shared';

/* ============================================================================
   La tarjeta de evento: lo que convierte el módulo en algo más que un chat.

   Un evento del producto (llamada perdida, hueco libre, traspaso de WhatsApp)
   llega al canal como una tarjeta con color propio, icono propio y BOTONES que
   resuelven el asunto sin salir del hilo. Si esto no se ve excelente, el
   equipo silencia el canal y el módulo muere.
   ========================================================================== */

/** Título en la primera línea, cuerpo en el resto. Igual que un email. */
function splitTitle(message: ImMessageDTO): { title: string; body: string } {
  const fromPayload = message.contextPayload?.title;
  const raw = (message.body ?? '').replace(/\r\n/g, '\n');

  if (typeof fromPayload === 'string' && fromPayload.trim()) {
    return { title: fromPayload.trim(), body: raw.trim() };
  }

  const lines = raw.split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) return { title: 'Evento', body: '' };

  const title = (lines[firstIdx] ?? '')
    .replace(/^[#>\s]*/, '')
    .replace(/\*\*/g, '')
    .trim();
  const body = lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim();
  return { title: title || 'Evento', body };
}

export function EventCard({
  message,
  channelTone,
  mentions,
  onAction,
  className,
}: {
  message: ImMessageDTO;
  channelTone: ImTone;
  mentions?: MentionIndex;
  onAction?: (action: ImAction, message: ImMessageDTO) => Promise<void> | void;
  className?: string;
}) {
  const tone = eventTone(message.eventKey, channelTone);
  const meta = toneMeta(tone);
  const Icon = eventIcon(message.eventKey);
  const { title, body } = splitTitle(message);

  const contextLabel =
    typeof message.contextPayload?.label === 'string'
      ? (message.contextPayload.label as string)
      : typeof message.contextPayload?.name === 'string'
        ? (message.contextPayload.name as string)
        : null;

  return (
    <Card
      tone={meta.card}
      className={cn(
        'spotlight group relative animate-fade-up overflow-hidden p-4 transition-shadow duration-500 hover:shadow-[var(--shadow-lifted)]',
        className,
      )}
    >
      {/* Halo de color en la esquina — profundidad sin recargar */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/60 blur-2xl"
      />

      <div className="relative flex items-start gap-3">
        <span
          className={cn(
            'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white/80 shadow-[var(--shadow-soft)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110',
            meta.text,
          )}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[17px] font-bold leading-tight tracking-tight text-zinc-900">
              {title}
            </h4>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[12px] font-bold uppercase tracking-[0.1em]',
                meta.text,
              )}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {eventLabel(message.eventKey)}
            </span>
          </div>

          {contextLabel && (
            <p className="mt-1 text-[14px] font-medium text-zinc-500">{contextLabel}</p>
          )}

          {body && <RichText text={body} mentions={mentions} className="mt-2 text-zinc-700" />}

          {message.actions.length > 0 && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {message.actions.map((action) => (
                <EventActionButton
                  key={action.id}
                  action={action}
                  message={message}
                  onAction={onAction}
                />
              ))}
            </div>
          )}

          <p className="mt-2.5 text-[13px] font-medium text-zinc-400" suppressHydrationWarning>
            {formatClock(message.createdAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Botón de acción de la tarjeta. `href` navega (interno con `Link`, externo con
 * `<a>`); `action` hace POST a esa ruta con `payload` y confirma en el sitio.
 */
function EventActionButton({
  action,
  message,
  onAction,
}: {
  action: ImAction;
  message: ImMessageDTO;
  onAction?: (action: ImAction, message: ImMessageDTO) => Promise<void> | void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  const variant =
    action.tone === 'primary'
      ? 'primary'
      : action.tone === 'danger'
        ? 'danger'
        : action.tone === 'soft'
          ? 'soft'
          : 'secondary';

  if (action.href) {
    const external = /^https?:\/\//.test(action.href);
    return (
      <Button asChild variant={variant} size="sm">
        {external ? (
          <a href={action.href} target="_blank" rel="noreferrer">
            {action.label}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link href={action.href}>{action.label}</Link>
        )}
      </Button>
    );
  }

  if (!action.action) return null;

  const run = async () => {
    if (state === 'busy' || state === 'done') return;
    setState('busy');
    try {
      if (onAction) {
        await onAction(action, message);
      } else {
        const res = await fetch(action.action as string, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action.payload ?? {}),
        });
        if (!res.ok) throw new Error('acción rechazada');
      }
      setState('done');
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2500);
    }
  };

  return (
    <Button
      variant={state === 'done' ? 'success' : variant}
      size="sm"
      onClick={run}
      disabled={state === 'busy' || state === 'done'}
      className={state === 'done' ? 'animate-pop' : undefined}
    >
      {state === 'done' && <Check className="h-3.5 w-3.5" />}
      {state === 'busy' ? 'Un momento…' : state === 'error' ? 'No se pudo' : action.label}
    </Button>
  );
}
