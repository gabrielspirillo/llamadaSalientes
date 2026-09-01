'use client';

import {
  type MentionIndex,
  PersonAvatar,
  attachmentUrl,
  channelIcon,
  formatBytes,
  formatDateTime,
  isImageAttachment,
  plainPreview,
  toneMeta,
} from '@/components/messaging/shared';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTopbar } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { cn } from '@/lib/cn';
import type { ImChannelDTO, ImMessageDTO, ImPerson, ImPresence } from '@/lib/messaging/types';
import {
  ChevronDown,
  ExternalLink,
  FileText,
  MessageCircle,
  Phone,
  Pin,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

/* ============================================================================
   Columna derecha: todo lo que hace falta para actuar sin salir del hilo —
   quién está, de qué va el canal, qué se fijó, qué se adjuntó, y (si el canal
   es de una entidad) la ficha con sus accesos directos.
   ========================================================================== */

/** Lee una clave del payload como string, sin confiar en su forma. */
function str(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

export function ContextPanel({
  channel,
  messages,
  pins,
  people,
  presence,
  currentUserId,
  onJumpToMessage,
  onTogglePin,
  onClose,
  className,
}: {
  channel: ImChannelDTO | null;
  messages: ImMessageDTO[];
  pins: ImMessageDTO[];
  people: ImPerson[];
  presence: Map<string, ImPresence>;
  currentUserId: string | null;
  mentions?: MentionIndex;
  onJumpToMessage: (messageId: string) => void;
  onTogglePin: (message: ImMessageDTO) => void;
  onClose: () => void;
  className?: string;
}) {
  const [pinsOpen, setPinsOpen] = useState(true);

  const members = useMemo(
    () =>
      (channel?.memberIds ?? [])
        .map((id) => people.find((p) => p.userId === id))
        .filter((p): p is ImPerson => !!p)
        .sort((a, b) => {
          const oa = presence.get(a.userId)?.online ? 0 : 1;
          const ob = presence.get(b.userId)?.online ? 0 : 1;
          return oa - ob || a.name.localeCompare(b.name, 'es');
        }),
    [channel?.memberIds, people, presence],
  );

  // `ImChannelDTO` no viaja con el payload de la entidad: lo tomamos del
  // mensaje más reciente del canal que sí lo trae (normalmente la tarjeta de
  // evento que abrió el hilo).
  const contextPayload = useMemo<Record<string, unknown>>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m) continue;
      const p = m.contextPayload;
      if (p && typeof p === 'object' && Object.keys(p).length > 0) return p;
    }
    return {};
  }, [messages]);

  const attachments = useMemo(() => {
    const out: Array<{ messageId: string; att: ImMessageDTO['attachments'][number] }> = [];
    for (let i = messages.length - 1; i >= 0 && out.length < 8; i -= 1) {
      const m = messages[i];
      if (!m || m.deletedAt) continue;
      for (const att of m.attachments) out.push({ messageId: m.id, att });
    }
    return out.slice(0, 8);
  }, [messages]);

  if (!channel) {
    return (
      <Card tone="glass" className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
        <p className="px-5 py-10 text-center text-[12.5px] text-zinc-500">
          Elegí un canal para ver su contexto.
        </p>
      </Card>
    );
  }

  const tone = toneMeta(channel.tone);
  const Icon = channelIcon(channel);
  const onlineCount = members.filter((m) => presence.get(m.userId)?.online).length;

  return (
    <Card tone="glass" className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <CardTopbar
        icon={<Icon className="h-4 w-4" />}
        tone={tone.card}
        title={channel.name}
        subtitle={
          channel.kind === 'DM'
            ? 'Mensaje directo'
            : `${members.length} ${members.length === 1 ? 'persona' : 'personas'} · ${onlineCount} en línea`
        }
        className="shrink-0 p-4 pb-3"
        action={
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar contexto"
            className="press inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        }
      />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5">
        {/* Ficha de la entidad — solo en canales de contexto */}
        {channel.kind === 'CONTEXT' && (
          <EntityCard channel={channel} payload={contextPayload} />
        )}

        {channel.topic && (
          <Section title="Tema">
            <p className="text-[12.5px] leading-relaxed text-zinc-600">{channel.topic}</p>
          </Section>
        )}

        {/* Fijados */}
        {pins.length > 0 && (
          <Section
            title={`Fijados (${pins.length})`}
            action={
              <button
                type="button"
                onClick={() => setPinsOpen((v) => !v)}
                aria-label={pinsOpen ? 'Colapsar fijados' : 'Ver fijados'}
                className="press inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-white hover:text-brand-600"
              >
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-300',
                    pinsOpen ? 'rotate-0' : '-rotate-90',
                  )}
                />
              </button>
            }
          >
            {pinsOpen && (
              <div className="space-y-2">
                {pins.map((p) => (
                  <Callout key={p.id} tone="warn" icon={<Pin className="h-3.5 w-3.5" />}>
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(p.id)}
                      className="block w-full text-left"
                    >
                      <span className="block text-[12px] font-semibold text-amber-900">
                        {p.senderName ?? 'Futura'}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-amber-900/80">
                        {plainPreview(p.body, 120)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePin(p)}
                      className="mt-1.5 text-[10.5px] font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
                    >
                      Quitar de fijados
                    </button>
                  </Callout>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Miembros */}
        <Section title="Miembros">
          <ul className="space-y-1">
            {members.map((m) => {
              const online = presence.get(m.userId)?.online ?? false;
              const status = presence.get(m.userId);
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-[12px] px-1.5 py-1 transition-colors hover:bg-white/70"
                >
                  <PersonAvatar name={m.name} seed={m.userId} size={26} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-zinc-800">
                      {m.name}
                      {m.userId === currentUserId && (
                        <span className="ml-1 text-[10.5px] font-normal text-zinc-400">(vos)</span>
                      )}
                    </span>
                    {status?.statusText && (
                      <span className="block truncate text-[10.5px] text-zinc-400">
                        {status.statusEmoji ? `${status.statusEmoji} ` : ''}
                        {status.statusText}
                      </span>
                    )}
                  </span>
                  {online ? (
                    <StatusDot tone="success" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-zinc-200" />
                  )}
                </li>
              );
            })}
            {members.length === 0 && (
              <li className="px-1.5 py-2 text-[12px] text-zinc-400">Sin miembros cargados.</li>
            )}
          </ul>
        </Section>

        {/* Adjuntos recientes */}
        {attachments.length > 0 && (
          <Section title="Archivos recientes">
            <ul className="space-y-1.5">
              {attachments.map(({ messageId, att }) => (
                <li key={`${messageId}-${att.key}`}>
                  <a
                    href={attachmentUrl(att)}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-2.5 rounded-[12px] bg-white/70 px-2 py-1.5 transition-all duration-300 hover:bg-white hover:shadow-[var(--shadow-soft)]"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-brand-50 text-brand-600">
                      {isImageAttachment(att) ? (
                        // biome-ignore lint/a11y/useAltText: el alt sale del nombre del archivo
                        <img
                          src={attachmentUrl(att)}
                          alt={att.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-zinc-700">
                        {att.name}
                      </span>
                      <span className="block text-[10px] text-zinc-400">
                        {formatBytes(att.size)}
                      </span>
                    </span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-zinc-300 transition-colors group-hover:text-brand-500" />
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Actividad */}
        <Section title="Actividad">
          <dl className="space-y-1.5 text-[12px]">
            <Row label="Mensajes" value={String(channel.messageCount)} />
            {channel.lastMessageAt && (
              <Row label="Último" value={formatDateTime(channel.lastMessageAt)} />
            )}
            <Row
              label="Tu rol"
              value={channel.memberRole === 'OWNER' ? 'Responsable' : 'Miembro'}
            />
            {channel.muted && <Row label="Avisos" value="Silenciado" />}
          </dl>
        </Section>
      </div>
    </Card>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400">
          <span className="h-2.5 w-1 rounded-full bg-[linear-gradient(180deg,#7139e8,#ec4899)]" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="truncate font-semibold text-zinc-700" suppressHydrationWarning>
        {value}
      </dd>
    </div>
  );
}

/**
 * Tarjeta de la entidad del canal (paciente, llamada, conversación de
 * WhatsApp…) construida desde `contextPayload`, con los accesos que evitan
 * cambiar de pantalla.
 */
function EntityCard({
  channel,
  payload,
}: {
  channel: ImChannelDTO;
  payload: Record<string, unknown>;
}) {
  const name = str(payload, 'name', 'label', 'title', 'patientName') ?? channel.contextLabel ?? channel.name;
  const subtitle = str(payload, 'subtitle', 'treatment', 'summary', 'reason');
  const phone = str(payload, 'phone', 'phoneE164', 'phoneNumber');
  const nextAppointment = str(payload, 'nextAppointmentAt', 'appointmentAt', 'startsAt');
  const href = str(payload, 'href', 'url');
  const conversationId = str(payload, 'whatsappConversationId', 'conversationId');
  const callId = str(payload, 'callId');
  const taskId = str(payload, 'taskId');

  const fallbackHref =
    channel.contextType === 'CALL' && (callId ?? channel.contextId)
      ? `/dashboard/calls/${callId ?? channel.contextId}`
      : channel.contextType === 'TASK' && (taskId ?? channel.contextId)
        ? '/dashboard/tasks'
        : channel.contextType === 'PATIENT'
          ? '/dashboard/contacts'
          : null;

  const fichaHref = href ?? fallbackHref;
  const waHref = conversationId ? `/dashboard/whatsapp/${conversationId}` : null;

  return (
    <Card
      tone={toneMeta(channel.tone).card}
      className="gradient-ring hover-lift relative overflow-hidden p-3.5"
    >
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-white/80 text-brand-600 shadow-[var(--shadow-soft)]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold tracking-tight text-zinc-900">{name}</p>
          {subtitle && <p className="mt-0.5 truncate text-[12px] text-zinc-600">{subtitle}</p>}
          {phone && (
            <p className="mt-0.5 truncate text-[12px] font-medium text-zinc-500">{phone}</p>
          )}
          {nextAppointment && (
            <Badge tone="violet" size="sm" className="mt-1.5">
              Próxima cita: {formatDateTime(nextAppointment)}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {fichaHref && (
          <Button asChild size="xs" variant="secondary">
            <Link href={fichaHref}>
              <Users className="h-3 w-3" />
              Ver ficha
            </Link>
          </Button>
        )}
        {phone && (
          <Button asChild size="xs" variant="secondary">
            <a href={`tel:${phone.replace(/\s+/g, '')}`}>
              <Phone className="h-3 w-3" />
              Llamar
            </a>
          </Button>
        )}
        {waHref && (
          <Button asChild size="xs" variant="secondary">
            <Link href={waHref}>
              <MessageCircle className="h-3 w-3" />
              Abrir WhatsApp
            </Link>
          </Button>
        )}
      </div>
    </Card>
  );
}
