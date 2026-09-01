// Constantes del módulo Mensajes. Espejo de los enums de la migración 0019.
// Se mantiene separado de schema.ts para poder importarlo desde el cliente.

export const IM_CHANNEL_KINDS = ['PUBLIC', 'PRIVATE', 'DM', 'GROUP', 'CONTEXT'] as const;
export type ImChannelKind = (typeof IM_CHANNEL_KINDS)[number];

export const IM_CONTEXT_TYPES = [
  'PATIENT',
  'TASK',
  'CALL',
  'WA_CONVERSATION',
  'WAITLIST_ENTRY',
  'APPOINTMENT',
  'CAMPAIGN',
] as const;
export type ImContextType = (typeof IM_CONTEXT_TYPES)[number];

export const IM_SENDER_KINDS = ['USER', 'SYSTEM', 'BOT'] as const;
export type ImSenderKind = (typeof IM_SENDER_KINDS)[number];

export const IM_MESSAGE_KINDS = ['TEXT', 'SYSTEM', 'EVENT', 'DECISION'] as const;
export type ImMessageKind = (typeof IM_MESSAGE_KINDS)[number];

export const IM_MEMBER_ROLES = ['OWNER', 'MEMBER'] as const;
export type ImMemberRole = (typeof IM_MEMBER_ROLES)[number];

/** Mismo vocabulario de color que el sidebar y las Card del sistema Aurora. */
export const IM_TONES = ['brand', 'blossom', 'mint', 'sky', 'honey', 'coral'] as const;
export type ImTone = (typeof IM_TONES)[number];

export function isImTone(v: unknown): v is ImTone {
  return typeof v === 'string' && (IM_TONES as readonly string[]).includes(v);
}

// ─── Canales sembrados en la primera visita ──────────────────────────────────
// Tres y no más: un rail que arranca con doce canales vacíos no lo usa nadie.
export const SEED_CHANNELS: ReadonlyArray<{
  slug: string;
  name: string;
  topic: string;
  icon: string;
  tone: ImTone;
}> = [
  {
    slug: 'general',
    name: 'General',
    topic: 'Todo el equipo. Avisos, coordinación del día y lo que no encaja en otro sitio.',
    icon: 'Hash',
    tone: 'brand',
  },
  {
    slug: 'agenda',
    name: 'Agenda',
    topic: 'Huecos liberados, cambios de cita y movimientos del calendario.',
    icon: 'Calendar',
    tone: 'mint',
  },
  {
    slug: 'urgencias',
    name: 'Urgencias',
    topic: 'Lo que no puede esperar: llamadas perdidas, traspasos y pacientes en riesgo de fuga.',
    icon: 'Siren',
    tone: 'coral',
  },
] as const;

// ─── Eventos del producto que publican tarjetas ──────────────────────────────
// El catálogo arranca corto a propósito: si el bot publica todo, el equipo
// silencia el canal y el módulo muere. Cada evento nuevo se agrega con umbral.
export const IM_EVENTS = [
  'call.missed',
  'call.transferred_unanswered',
  'wa.handoff',
  'waitlist.slot_open',
  'waitlist.book_failed',
  'reminder.no_response',
  'appointment.cancelled',
  'appointment.no_show',
  'task.assigned',
  'task.overdue_digest',
  'analytics.daily_digest',
  'analytics.threshold_alert',
] as const;
export type ImEvent = (typeof IM_EVENTS)[number];

/** A qué canal va cada evento por defecto, y con qué color se pinta. */
export const IM_EVENT_ROUTING: Record<ImEvent, { slug: string; tone: ImTone }> = {
  'call.missed': { slug: 'urgencias', tone: 'coral' },
  'call.transferred_unanswered': { slug: 'urgencias', tone: 'coral' },
  'wa.handoff': { slug: 'urgencias', tone: 'mint' },
  'waitlist.slot_open': { slug: 'agenda', tone: 'mint' },
  'waitlist.book_failed': { slug: 'urgencias', tone: 'honey' },
  'reminder.no_response': { slug: 'agenda', tone: 'honey' },
  'appointment.cancelled': { slug: 'agenda', tone: 'honey' },
  'appointment.no_show': { slug: 'agenda', tone: 'coral' },
  'task.assigned': { slug: 'general', tone: 'blossom' },
  'task.overdue_digest': { slug: 'general', tone: 'blossom' },
  'analytics.daily_digest': { slug: 'general', tone: 'sky' },
  'analytics.threshold_alert': { slug: 'general', tone: 'sky' },
};

/** Cuántos mensajes trae cada página del hilo (paginación keyset). */
export const THREAD_PAGE_SIZE = 50;

/** Ventana en la que el autor todavía puede editar su mensaje. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** TTL del "está escribiendo" en Redis. No tiene valor pasado ese tiempo. */
export const TYPING_TTL_SECONDS = 6;

/** TTL de la presencia; el SSE la refresca cada 20 s. */
export const PRESENCE_TTL_SECONDS = 45;

export const MAX_BODY_LENGTH = 8000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const REACTION_EMOJIS = ['👍', '✅', '👀', '🎉', '❤️', '😂', '🙏', '🔥'] as const;
