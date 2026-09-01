'use client';

import { cn } from '@/lib/cn';
import { IM_EVENT_ROUTING, type ImEvent, type ImTone } from '@/lib/messaging/constants';
import type { ImAttachment, ImChannelDTO, ImPerson, ImPresence } from '@/lib/messaging/types';
import {
  BarChart3,
  BellOff,
  Calendar,
  CalendarClock,
  CalendarOff,
  CalendarX,
  FileText,
  Hash,
  ListTodo,
  Lock,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  PhoneMissed,
  PhoneOff,
  Siren,
  Sparkles,
  TrendingUp,
  UserX,
  Users,
} from 'lucide-react';
import type * as React from 'react';

/* ============================================================================
   Piezas compartidas del módulo Mensajes.

   Todo lo que se repite entre el rail, el hilo, el panel de contexto y las
   tarjetas de evento vive acá: si una hora, un tono o una mención no se ven
   igual en los cuatro sitios, el módulo deja de leerse como una sola cosa.
   ========================================================================== */

// ─── Tonos ───────────────────────────────────────────────────────────────────

export interface ToneMeta {
  /** Tono de `Card` del sistema Aurora — su vocabulario, no el nuestro: `Card`
   *  sigue llamando 'grape' a su tono de marca aunque ya pinte verde. */
  card: 'grape' | 'blossom' | 'mint' | 'sky' | 'honey' | 'coral';
  /** Pastilla del icono (fondo + texto). */
  chip: string;
  /** Texto de acento. */
  text: string;
  /** Fondo muy suave para resaltar filas. */
  soft: string;
  /** Borde a juego. */
  border: string;
  /** Punto de color plano. */
  dot: string;
}

export const TONE_META: Record<ImTone, ToneMeta> = {
  brand: {
    // `Card` conserva 'grape' como nombre de su tono de marca aunque el color
    // ya sea verde: es su vocabulario, no el nuestro.
    card: 'grape',
    chip: 'bg-brand-100 text-brand-600',
    text: 'text-brand-700',
    soft: 'bg-brand-50/70',
    border: 'border-brand-100',
    dot: 'bg-brand-500',
  },
  blossom: {
    card: 'blossom',
    chip: 'bg-emerald-100 text-emerald-600',
    text: 'text-emerald-700',
    soft: 'bg-emerald-50/70',
    border: 'border-emerald-100',
    dot: 'bg-emerald-500',
  },
  mint: {
    card: 'mint',
    chip: 'bg-emerald-100 text-emerald-600',
    text: 'text-emerald-700',
    soft: 'bg-emerald-50/70',
    border: 'border-emerald-100',
    dot: 'bg-emerald-500',
  },
  sky: {
    card: 'sky',
    chip: 'bg-sky-100 text-sky-600',
    text: 'text-sky-700',
    soft: 'bg-sky-50/70',
    border: 'border-sky-100',
    dot: 'bg-sky-500',
  },
  honey: {
    card: 'honey',
    chip: 'bg-amber-100 text-amber-600',
    text: 'text-amber-700',
    soft: 'bg-amber-50/70',
    border: 'border-amber-100',
    dot: 'bg-amber-500',
  },
  coral: {
    card: 'coral',
    chip: 'bg-rose-100 text-rose-600',
    text: 'text-rose-700',
    soft: 'bg-rose-50/70',
    border: 'border-rose-100',
    dot: 'bg-rose-500',
  },
};

export function toneMeta(tone: ImTone | null | undefined): ToneMeta {
  return TONE_META[tone ?? 'brand'] ?? TONE_META.brand;
}

/** Barra de acento del ítem activo — la misma del `NavLink` del sidebar. */
export const ACTIVE_BAR = 'bg-[linear-gradient(180deg,#37766a,#6bc2a4)]';

// ─── Iconos ──────────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  Hash,
  Calendar,
  Siren,
  Users,
  MessageSquare,
  MessageCircle,
  ListTodo,
  Sparkles,
  FileText,
  Lock,
};

/** Icono del canal: el que guardó la BD, o uno razonable según su tipo. */
export function channelIcon(channel: Pick<ImChannelDTO, 'icon' | 'kind'>): LucideIcon {
  if (channel.icon && CHANNEL_ICONS[channel.icon]) return CHANNEL_ICONS[channel.icon] as LucideIcon;
  switch (channel.kind) {
    case 'DM':
      return MessageCircle;
    case 'GROUP':
      return Users;
    case 'PRIVATE':
      return Lock;
    case 'CONTEXT':
      return Sparkles;
    default:
      return Hash;
  }
}

const EVENT_ICONS: Record<ImEvent, LucideIcon> = {
  'call.missed': PhoneMissed,
  'call.transferred_unanswered': PhoneOff,
  'wa.handoff': MessageCircle,
  'waitlist.slot_open': CalendarClock,
  'waitlist.book_failed': CalendarX,
  'reminder.no_response': BellOff,
  'appointment.cancelled': CalendarOff,
  'appointment.no_show': UserX,
  'task.assigned': ListTodo,
  'task.overdue_digest': ListTodo,
  'analytics.daily_digest': BarChart3,
  'analytics.threshold_alert': TrendingUp,
};

export function eventIcon(eventKey: string | null | undefined): LucideIcon {
  if (eventKey && eventKey in EVENT_ICONS) return EVENT_ICONS[eventKey as ImEvent];
  return Sparkles;
}

/** Tono del evento según el routing del catálogo; cae al tono del canal. */
export function eventTone(eventKey: string | null | undefined, fallback: ImTone): ImTone {
  if (eventKey && eventKey in IM_EVENT_ROUTING) {
    return IM_EVENT_ROUTING[eventKey as ImEvent].tone;
  }
  return fallback;
}

/** Etiqueta legible del evento, para el pie de la tarjeta. */
const EVENT_LABELS: Record<ImEvent, string> = {
  'call.missed': 'Llamada perdida',
  'call.transferred_unanswered': 'Transferencia sin respuesta',
  'wa.handoff': 'Traspaso de WhatsApp',
  'waitlist.slot_open': 'Hueco libre',
  'waitlist.book_failed': 'No se pudo agendar',
  'reminder.no_response': 'Recordatorio sin respuesta',
  'appointment.cancelled': 'Cita cancelada',
  'appointment.no_show': 'No se presentó',
  'task.assigned': 'Tarea asignada',
  'task.overdue_digest': 'Tareas vencidas',
  'analytics.daily_digest': 'Resumen del día',
  'analytics.threshold_alert': 'Alerta de umbral',
};

export function eventLabel(eventKey: string | null | undefined): string {
  if (eventKey && eventKey in EVENT_LABELS) return EVENT_LABELS[eventKey as ImEvent];
  return 'Evento';
}

// ─── Personas ────────────────────────────────────────────────────────────────

export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Color estable por identificador — la misma persona siempre sale igual. */
const AVATAR_TONES = [
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
] as const;

export function avatarTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length] as string;
}

/**
 * Avatar con iniciales. `online` dibuja el anillo de marca (`.gradient-ring`)
 * que en el sistema Aurora significa "está conectado".
 */
export function PersonAvatar({
  name,
  seed,
  size = 32,
  online,
  className,
}: {
  name: string;
  seed?: string;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        title={name}
        className={cn(
          'inline-flex items-center justify-center rounded-full font-bold ring-2 ring-white',
          avatarTone(seed ?? name),
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      >
        {initialsOf(name)}
      </span>
      {online && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white"
        />
      )}
    </span>
  );
}

export function presenceMap(presence: ImPresence[]): Map<string, ImPresence> {
  const m = new Map<string, ImPresence>();
  for (const p of presence) m.set(p.userId, p);
  return m;
}

export function peopleMap(people: ImPerson[]): Map<string, ImPerson> {
  const m = new Map<string, ImPerson>();
  for (const p of people) m.set(p.userId, p);
  return m;
}

// ─── Menciones ───────────────────────────────────────────────────────────────

export interface MentionIndex {
  /** handle en minúsculas → persona. */
  byHandle: Map<string, ImPerson>;
  /** userId → handle tal cual se escribe (con mayúscula inicial). */
  forPerson: Map<string, string>;
}

const HANDLE_CLEAN = /[^\p{L}\p{N}._-]/gu;

/**
 * Handles de mención: el nombre de pila, y si choca con otro se le suma la
 * inicial del apellido. Cortos porque se escriben a mano cien veces al día.
 */
export function buildMentionIndex(people: ImPerson[]): MentionIndex {
  const byHandle = new Map<string, ImPerson>();
  const forPerson = new Map<string, string>();

  for (const person of people) {
    const words = person.name.split(/\s+/).filter(Boolean);
    const base = (words[0] ?? person.email.split('@')[0] ?? 'usuario').replace(HANDLE_CLEAN, '');
    let handle = base || 'usuario';
    let attempt = 1;
    while (byHandle.has(handle.toLowerCase())) {
      const extra = words[attempt]?.replace(HANDLE_CLEAN, '');
      handle = extra ? `${base}${extra[0]?.toUpperCase() ?? ''}` : `${base}${attempt + 1}`;
      attempt += 1;
      if (attempt > 8) {
        handle = `${base}${person.userId.slice(0, 4)}`;
        break;
      }
    }
    byHandle.set(handle.toLowerCase(), person);
    forPerson.set(person.userId, handle);
  }

  return { byHandle, forPerson };
}

/** Menciones especiales que siempre se resaltan. */
const EVERYONE_HANDLES = new Set(['todos', 'canal', 'aqui', 'aquí', 'everyone', 'channel']);

export function isEveryoneHandle(handle: string): boolean {
  return EVERYONE_HANDLES.has(handle.toLowerCase());
}

/** userIds mencionados en un texto, según el índice de handles. */
export function mentionedUserIds(text: string, index: MentionIndex): string[] {
  const found = new Set<string>();
  const re = /@([\p{L}\p{N}._-]+)/gu;
  let m = re.exec(text);
  while (m) {
    const person = index.byHandle.get((m[1] ?? '').toLowerCase());
    if (person) found.add(person.userId);
    m = re.exec(text);
  }
  return Array.from(found);
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const secs = Math.max(0, (nowMs - t) / 1000);
  if (secs < 45) return 'ahora';
  if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
  if (secs < 86_400) return `hace ${Math.floor(secs / 3600)} h`;
  if (secs < 172_800) return 'ayer';
  if (secs < 604_800) return `hace ${Math.floor(secs / 86_400)} d`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function formatDayDivider(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoy';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ayer';
  return d.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Adjuntos ────────────────────────────────────────────────────────────────

export function isImageAttachment(a: ImAttachment): boolean {
  return typeof a.mime === 'string' && a.mime.startsWith('image/');
}

/**
 * URL de descarga del adjunto. La API de subida devuelve la clave pública de
 * MinIO; si ya viene absoluta se usa tal cual.
 */
export function attachmentUrl(a: ImAttachment): string {
  const key = a.key ?? '';
  if (!key) return '';
  // Una key absoluta viene de un adjunto ya resuelto (o de un origen externo).
  if (/^(https?:)?\/\//.test(key)) return key;
  // El resto se sirve por la ruta que firma en la lectura: la URL firmada
  // caduca, así que no puede vivir guardada en el mensaje.
  return `/api/messages/attachments?key=${encodeURIComponent(key)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// ─── Markdown acotado y seguro ───────────────────────────────────────────────
//
// Se parsea a nodos de React a mano: nada de dangerouslySetInnerHTML. Soporta
// negrita, cursiva, código en línea, bloques de código, enlaces, listas, citas
// y menciones. Cualquier otra sintaxis se muestra literal, que es lo correcto:
// el equipo escribe mensajes, no documentos.

const INLINE_RE =
  /`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\*[^*\n/]+?\*|_[^_\n/]+?_|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^\s)]+\)|https?:\/\/[^\s<>()]+|@[\p{L}\p{N}._-]+/gu;

function linkClass(): string {
  return 'font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-800 hover:decoration-brand-500';
}

function MentionChip({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        'mx-px inline-flex items-center rounded-md px-1 py-px text-[0.95em] font-semibold',
        strong ? 'bg-brand-600 text-white' : 'bg-brand-100/90 text-brand-700',
      )}
    >
      @{label}
    </span>
  );
}

function parseInline(
  text: string,
  index: MentionIndex | undefined,
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;

  INLINE_RE.lastIndex = 0;
  let m = INLINE_RE.exec(text);
  while (m) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyPrefix}-i${n}`;
    n += 1;

    if (token.startsWith('`')) {
      out.push(
        <code
          key={key}
          className="rounded-md border border-[--color-border] bg-[#fbfaff] px-1.5 py-0.5 font-mono text-[0.86em] text-brand-700"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(
        <strong key={key} className="font-semibold text-zinc-900">
          {parseInline(token.slice(2, -2), index, key)}
        </strong>,
      );
    } else if (token.startsWith('*') || token.startsWith('_')) {
      out.push(
        <em key={key} className="italic">
          {parseInline(token.slice(1, -1), index, key)}
        </em>,
      );
    } else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\((.+)\)$/.exec(token);
      const label = parts?.[1] ?? token;
      const href = parts?.[2] ?? '#';
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className={linkClass()}>
          {label}
        </a>,
      );
    } else if (token.startsWith('http')) {
      out.push(
        <a key={key} href={token} target="_blank" rel="noreferrer" className={linkClass()}>
          {token.replace(/^https?:\/\//, '')}
        </a>,
      );
    } else if (token.startsWith('@')) {
      const handle = token.slice(1);
      const person = index?.byHandle.get(handle.toLowerCase());
      if (person) {
        out.push(<MentionChip key={key} label={index?.forPerson.get(person.userId) ?? handle} />);
      } else if (isEveryoneHandle(handle)) {
        out.push(<MentionChip key={key} label={handle} strong />);
      } else {
        out.push(token);
      }
    } else {
      out.push(token);
    }

    last = m.index + token.length;
    m = INLINE_RE.exec(text);
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Block {
  type: 'p' | 'code' | 'ul' | 'ol' | 'quote';
  lines: string[];
  lang?: string;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // cierre
      blocks.push({ type: 'code', lines: body, lang });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*+]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', lines: items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', lines: items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', lines: items });
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() !== '' &&
      !/^\s*([-*+]\s+|\d+[.)]\s+|>\s?)/.test(lines[i] ?? '') &&
      !(lines[i] ?? '').trimStart().startsWith('```')
    ) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push({ type: 'p', lines: para });
  }

  return blocks;
}

/**
 * Render de markdown acotado. `mentions` permite resaltar `@nombre` contra las
 * personas reales del tenant.
 */
export function RichText({
  text,
  mentions,
  className,
}: {
  text: string;
  mentions?: MentionIndex;
  className?: string;
}) {
  const blocks = parseBlocks(text ?? '');

  return (
    <div className={cn('space-y-2 text-[16px] leading-relaxed', className)}>
      {blocks.map((block, bi) => {
        const key = `b${bi}-${block.type}`;

        if (block.type === 'code') {
          return (
            <pre
              key={key}
              className="scrollbar-none overflow-x-auto rounded-[14px] border border-[--color-border] bg-[#fbfaff] p-3 font-mono text-[14px] leading-relaxed text-zinc-700"
            >
              <code>{block.lines.join('\n')}</code>
            </pre>
          );
        }

        if (block.type === 'ul' || block.type === 'ol') {
          const Tag = block.type === 'ul' ? 'ul' : 'ol';
          return (
            <Tag
              key={key}
              className={cn(
                'ml-4 space-y-1',
                block.type === 'ul'
                  ? 'list-disc marker:text-brand-300'
                  : 'list-decimal marker:text-brand-400',
              )}
            >
              {block.lines.map((li, li2) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: el bloque se re-parsea entero en cada render; las líneas nunca se reordenan
                <li key={`${key}-${li2}`} className="pl-0.5">
                  {parseInline(li, mentions, `${key}-${li2}`)}
                </li>
              ))}
            </Tag>
          );
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-zinc-200 bg-zinc-50/60 py-1 pl-3 text-zinc-600"
            >
              {block.lines.map((l, l2) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: mismo motivo: el markdown se re-parsea completo
                <p key={`${key}-${l2}`}>{parseInline(l, mentions, `${key}-${l2}`)}</p>
              ))}
            </blockquote>
          );
        }

        return (
          <p key={key} className="whitespace-pre-wrap break-words">
            {block.lines.map((l, l2) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: mismo motivo: el markdown se re-parsea completo
              <span key={`${key}-${l2}`}>
                {l2 > 0 && <br />}
                {parseInline(l, mentions, `${key}-${l2}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Texto plano de un cuerpo con markdown — para previews del rail. */
export function plainPreview(text: string | null | undefined, max = 90): string {
  const clean = (text ?? '')
    .replace(/```[\s\S]*?```/g, ' [código] ')
    .replace(/[*_`>#]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Tres puntos que rebotan, escalonados. El "está escribiendo" del sistema. */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-end gap-1', className)}>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400" />
    </span>
  );
}

/** "Ana está escribiendo" / "Ana y Lucía están escribiendo" / "3 personas…". */
export function typingLabel(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return '';
  if (unique.length === 1) return `${unique[0]} está escribiendo`;
  if (unique.length === 2) return `${unique[0]} y ${unique[1]} están escribiendo`;
  return `${unique.length} personas están escribiendo`;
}
