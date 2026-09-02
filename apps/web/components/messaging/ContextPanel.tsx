'use client';

import {
  type MentionIndex,
  PersonAvatar,
  attachmentUrl,
  channelIcon,
  formatBytes,
  formatDateTime,
  isAudioAttachment,
  isImageAttachment,
  isVideoAttachment,
  plainPreview,
  toneMeta,
} from '@/components/messaging/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/ui/feedback';
import { Switch } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type {
  ImAttachment,
  ImChannelDTO,
  ImMessageDTO,
  ImPerson,
  ImPresence,
} from '@/lib/messaging/types';
import {
  Bell,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  MessageCircle,
  Mic,
  Paperclip,
  Phone,
  Pin,
  Sparkles,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

/* ============================================================================
   Columna derecha: la ficha del canal. Todo lo que hace falta para actuar sin
   salir del hilo — quién está, de qué va, qué se fijó, qué se adjuntó, y (si el
   canal es de una entidad) sus accesos directos.
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

type FileBucket = {
  key: string;
  label: string;
  icon: typeof ImageIcon;
  chip: string;
  items: ImAttachment[];
};

export function ContextPanel({
  channel,
  messages,
  pins,
  people,
  presence,
  currentUserId,
  onJumpToMessage,
  onTogglePin,
  onManageMembers,
  onUpdateChannel,
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
  /** Abre la gestión de miembros. Ausente en canales que no la admiten. */
  onManageMembers?: () => void;
  /** Guarda preferencias del canal (silencio, fijado) para quien lo mira. */
  onUpdateChannel?: (patch: { muted?: boolean; pinned?: boolean }) => void;
  onClose: () => void;
  className?: string;
}) {
  const [pinsOpen, setPinsOpen] = useState(true);
  const [copied, setCopied] = useState(false);

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

  // Adjuntos agrupados por tipo, como en cualquier ficha de conversación: se
  // busca "la foto que mandó Ana", no "el mensaje del martes".
  const buckets = useMemo<FileBucket[]>(() => {
    const images: ImAttachment[] = [];
    const videos: ImAttachment[] = [];
    const audios: ImAttachment[] = [];
    const others: ImAttachment[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m || m.deletedAt) continue;
      for (const att of m.attachments) {
        if (isImageAttachment(att)) images.push(att);
        else if (isVideoAttachment(att)) videos.push(att);
        else if (isAudioAttachment(att)) audios.push(att);
        else others.push(att);
      }
    }
    return [
      {
        key: 'img',
        label: 'Fotos',
        icon: ImageIcon,
        chip: 'bg-brand-50 text-brand-700',
        items: images,
      },
      {
        key: 'vid',
        label: 'Vídeos',
        icon: Video,
        chip: 'bg-emerald-50 text-emerald-700',
        items: videos,
      },
      {
        key: 'aud',
        label: 'Notas de voz',
        icon: Mic,
        chip: 'bg-sky-50 text-sky-700',
        items: audios,
      },
      {
        key: 'doc',
        label: 'Documentos',
        icon: FileText,
        chip: 'bg-zinc-100 text-zinc-600',
        items: others,
      },
    ].filter((b) => b.items.length > 0);
  }, [messages]);

  const totalFiles = buckets.reduce((n, b) => n + b.items.length, 0);

  const copyLink = useCallback(() => {
    if (!channel) return;
    const url = `${window.location.origin}/dashboard/messages?channel=${channel.id}`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => undefined);
  }, [channel]);

  if (!channel) {
    return (
      <Card tone="glass" className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
        <p className="px-5 py-10 text-center text-[14px] text-zinc-500">
          Elige un canal para ver su ficha.
        </p>
      </Card>
    );
  }

  const tone = toneMeta(channel.tone);
  const Icon = channelIcon(channel);
  const onlineCount = members.filter((m) => presence.get(m.userId)?.online).length;

  return (
    <Card tone="glass" className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      {/* Cabecera-ficha: identidad del canal en grande, como una tarjeta de
          contacto, y no una barra de título más. */}
      <div className="relative shrink-0 overflow-hidden px-4 pb-4 pt-4 text-center">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(75%_100%_at_50%_0%,rgba(95,168,150,0.18),transparent_72%)]"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar la ficha del canal"
          className="press absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white hover:text-zinc-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="relative">
          <span className="relative mx-auto inline-flex">
            <span
              className={cn(
                'inline-flex h-16 w-16 items-center justify-center rounded-[22px] shadow-[0_18px_36px_-20px_rgba(22,26,25,0.75)]',
                tone.chip,
              )}
            >
              <Icon className="h-7 w-7" />
            </span>
            {onlineCount > 0 && (
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 ring-[3px] ring-white"
              />
            )}
          </span>

          <h2 className="mt-3 truncate text-[17px] font-bold tracking-tight text-zinc-900">
            {channel.name}
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {channel.kind === 'DM'
              ? 'Mensaje directo'
              : `${members.length} ${members.length === 1 ? 'persona' : 'personas'}${
                  onlineCount > 0 ? ` · ${onlineCount} en línea` : ''
                }`}
          </p>

          {channel.topic && (
            <p className="mx-auto mt-2 max-w-[260px] text-[13px] leading-relaxed text-zinc-500">
              {channel.topic}
            </p>
          )}

          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="xs" variant="secondary" onClick={copyLink}>
              {copied ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
              {copied ? 'Enlace copiado' : 'Copiar enlace'}
            </Button>
            {onManageMembers && (
              <Button size="xs" variant="soft" onClick={onManageMembers}>
                <UserPlus className="h-3 w-3" />
                Miembros
              </Button>
            )}
          </div>

          {/* Métricas del canal */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MetricTile
              label="Mensajes"
              value={channel.messageCount}
              icon={<MessageCircle className="h-3.5 w-3.5" />}
            />
            <MetricTile
              label="Archivos"
              value={totalFiles}
              icon={<Paperclip className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto border-t border-white/70 px-4 pb-5 pt-4">
        {/* Ficha de la entidad — solo en canales de contexto */}
        {channel.kind === 'CONTEXT' && <EntityCard channel={channel} payload={contextPayload} />}

        {/* Avisos del canal */}
        {onUpdateChannel && (
          <div className="space-y-1.5">
            <PreferenceRow
              icon={<Bell className="h-4 w-4" />}
              title="Avisos"
              hint={channel.muted ? 'Silenciado para ti' : 'Te avisamos de lo nuevo'}
              checked={!channel.muted}
              onCheckedChange={(on) => onUpdateChannel({ muted: !on })}
            />
            <PreferenceRow
              icon={<Pin className="h-4 w-4" />}
              title="Fijar arriba"
              hint="Se queda el primero de tu lista"
              checked={channel.pinned}
              onCheckedChange={(on) => onUpdateChannel({ pinned: on })}
            />
          </div>
        )}

        {/* Fijados */}
        {pins.length > 0 && (
          <Section
            title={`Fijados (${pins.length})`}
            action={
              <button
                type="button"
                onClick={() => setPinsOpen((v) => !v)}
                aria-label={pinsOpen ? 'Colapsar los fijados' : 'Ver los fijados'}
                className="press inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-white hover:text-zinc-700"
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
                      <span className="block text-[13px] font-semibold text-amber-900">
                        {p.senderName ?? 'Futura'}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-amber-900/80">
                        {plainPreview(p.body, 120)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePin(p)}
                      className="mt-1.5 text-[12px] font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-800"
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
        <Section
          title={`Miembros (${members.length})`}
          action={
            onManageMembers ? (
              <button
                type="button"
                onClick={onManageMembers}
                className="press inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-zinc-500 transition-colors hover:bg-white hover:text-zinc-800"
              >
                <UserPlus className="h-3 w-3" />
                Gestionar
              </button>
            ) : undefined
          }
        >
          <ul className="space-y-0.5">
            {members.map((m) => {
              const status = presence.get(m.userId);
              const online = status?.online ?? false;
              return (
                <li
                  key={m.userId}
                  className="flex items-center gap-2.5 rounded-[14px] px-2 py-1.5 transition-colors hover:bg-white/80"
                >
                  <PersonAvatar name={m.name} seed={m.userId} size={30} online={online} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-zinc-800">
                      {m.name}
                      {m.userId === currentUserId && (
                        <span className="ml-1 text-[12px] font-normal text-zinc-500">(tú)</span>
                      )}
                    </span>
                    <span className="block truncate text-[12px] text-zinc-500">
                      {status?.statusText
                        ? `${status.statusEmoji ? `${status.statusEmoji} ` : ''}${status.statusText}`
                        : online
                          ? 'En línea'
                          : 'Desconectado'}
                    </span>
                  </span>
                </li>
              );
            })}
            {members.length === 0 && (
              <li className="px-1.5 py-2 text-[13px] text-zinc-500">Sin miembros cargados.</li>
            )}
          </ul>
        </Section>

        {/* Archivos por tipo */}
        {buckets.length > 0 && (
          <Section title="Archivos compartidos">
            <div className="space-y-1.5">
              {buckets.map((b) => (
                <FileBucketRow key={b.key} bucket={b} />
              ))}
            </div>
          </Section>
        )}

        {channel.lastMessageAt && (
          <p className="px-1 text-[12px] text-zinc-500" suppressHydrationWarning>
            Último mensaje: {formatDateTime(channel.lastMessageAt)}
          </p>
        )}
      </div>
    </Card>
  );
}

function MetricTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[16px] bg-white/85 px-3 py-2.5 text-left ring-1 ring-[--color-border-subtle] transition-shadow duration-300 hover:shadow-[var(--shadow-soft)]">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
        <span className="text-brand-500">{icon}</span>
        {label}
      </span>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums tracking-tight text-zinc-900">
        {value}
      </p>
    </div>
  );
}

function PreferenceRow({
  icon,
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-[16px] bg-white/85 px-3 py-2.5 ring-1 ring-[--color-border-subtle]">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-brand-50 text-brand-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-zinc-800">{title}</span>
        <span className="block truncate text-[12px] text-zinc-500">{hint}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} label={title} />
    </div>
  );
}

/** Una fila por tipo de archivo, desplegable, con recuento y peso total. */
function FileBucketRow({ bucket }: { bucket: FileBucket }) {
  const [open, setOpen] = useState(false);
  const Icon = bucket.icon;
  const totalBytes = bucket.items.reduce((n, a) => n + (a.size || 0), 0);

  return (
    <div className="overflow-hidden rounded-[16px] bg-white/85 ring-1 ring-[--color-border-subtle]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white"
      >
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px]',
            bucket.chip,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-zinc-800">{bucket.label}</span>
          <span className="block text-[12px] text-zinc-500">
            {bucket.items.length} {bucket.items.length === 1 ? 'archivo' : 'archivos'}
            {totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ''}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-zinc-300 transition-transform duration-300',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <ul className="animate-fade-down space-y-1 border-t border-[--color-border-subtle] p-2">
          {bucket.items.slice(0, 12).map((att) => (
            <li key={att.key}>
              <a
                href={attachmentUrl(att)}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-2.5 rounded-[12px] px-2 py-1.5 transition-colors hover:bg-brand-50/70"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-brand-50 text-brand-600">
                  {isImageAttachment(att) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- adjunto arbitrario servido por la API firmada
                    <img
                      src={attachmentUrl(att)}
                      alt={att.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-zinc-700">
                    {att.name}
                  </span>
                  <span className="block text-[11px] text-zinc-500">{formatBytes(att.size)}</span>
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-300 transition-colors group-hover:text-brand-500" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
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
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
          <span className="h-2.5 w-1 rounded-full bg-[linear-gradient(180deg,#37766a,#6bc2a4)]" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
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
  const name =
    str(payload, 'name', 'label', 'title', 'patientName') ?? channel.contextLabel ?? channel.name;
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
          <p className="truncate text-[15px] font-bold tracking-tight text-zinc-900">{name}</p>
          {subtitle && <p className="mt-0.5 truncate text-[13px] text-zinc-600">{subtitle}</p>}
          {phone && (
            <p className="mt-0.5 truncate text-[13px] font-medium text-zinc-500">{phone}</p>
          )}
          {nextAppointment && (
            <Badge tone="accent" size="sm" className="mt-1.5">
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
