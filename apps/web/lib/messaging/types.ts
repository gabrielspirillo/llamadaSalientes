// DTOs que cruzan el borde server → client. Todo serializable (fechas en ISO).
// Mismo criterio que lib/tasks/types.ts.

import type { ImAction, ImAttachment } from '@/lib/db/schema';
import type {
  ImChannelKind,
  ImContextType,
  ImMemberRole,
  ImMessageKind,
  ImSenderKind,
  ImTone,
} from '@/lib/messaging/constants';

export type { ImAction, ImAttachment };

export interface ImPerson {
  /** users.id interno — el que referencian mensajes, menciones y reacciones. */
  userId: string;
  clerkUserId: string;
  email: string;
  /** Nombre legible: el de Clerk, o el local part del email. */
  name: string;
  initials: string;
  role: string;
}

export interface ImPresence {
  userId: string;
  online: boolean;
  statusEmoji: string | null;
  statusText: string | null;
}

export interface ImReactionDTO {
  emoji: string;
  count: number;
  /** users.id de quienes reaccionaron. Permite pintar "vos también". */
  userIds: string[];
}

export interface ImMessageDTO {
  id: string;
  channelId: string;
  kind: ImMessageKind;
  senderKind: ImSenderKind;
  senderUserId: string | null;
  senderName: string | null;
  senderInitials: string | null;
  body: string;
  parentId: string | null;
  replyCount: number;
  contextType: ImContextType | null;
  contextId: string | null;
  contextPayload: Record<string, unknown>;
  attachments: ImAttachment[];
  actions: ImAction[];
  eventKey: string | null;
  mentions: string[];
  mentionsEveryone: boolean;
  reactions: ImReactionDTO[];
  pinned: boolean;
  saved: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Solo en el envío optimista del cliente; el server no lo devuelve. */
  clientNonce?: string | null;
  pending?: boolean;
  failed?: boolean;
}

export interface ImChannelDTO {
  id: string;
  kind: ImChannelKind;
  slug: string | null;
  /** Ya resuelto: en un DM es el nombre de la otra persona. */
  name: string;
  topic: string | null;
  icon: string | null;
  tone: ImTone;
  isSystem: boolean;
  contextType: ImContextType | null;
  contextId: string | null;
  contextLabel: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  messageCount: number;
  archived: boolean;
  /** Del usuario que pide, no del canal. */
  unreadCount: number;
  mentionCount: number;
  muted: boolean;
  pinned: boolean;
  memberRole: ImMemberRole;
  memberIds: string[];
  /** En DM, la contraparte. Permite pintar avatar y presencia en el rail. */
  counterpartUserId: string | null;
}

/** Lo que hidrata el rail, el dock y los badges de una sola vez. */
export interface ImRailDTO {
  channels: ImChannelDTO[];
  people: ImPerson[];
  presence: ImPresence[];
  totalUnread: number;
  totalMentions: number;
  me: ImPerson | null;
}

export interface ImMentionDTO {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  body: string;
  senderName: string | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ImThreadPage {
  messages: ImMessageDTO[];
  /** ISO del mensaje más viejo devuelto; se pasa como `before` para seguir. */
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ImSearchHit {
  messageId: string;
  channelId: string;
  channelName: string;
  senderName: string | null;
  snippet: string;
  createdAt: string;
}
