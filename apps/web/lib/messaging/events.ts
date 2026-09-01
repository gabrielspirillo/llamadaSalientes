// Contrato de los eventos que viajan por Redis pub/sub y se reemiten por SSE.
// Espejo de lib/whatsapp/realtime/events.ts, generalizado.
//
// Convención heredada del stream de WhatsApp: el `kind` del payload se usa como
// nombre del `event:` de SSE, y el JSON entero va como `data:`.

import type { ImMessageDTO, ImPresence } from '@/lib/messaging/types';

/** Canal Redis personal. Una sola suscripción fija por sesión de usuario. */
export function userChannel(userId: string): string {
  return `im:user:${userId}`;
}

/** Canal de tenant, para presencia y cambios que ve todo el mundo. */
export function tenantChannel(tenantId: string): string {
  return `im:tenant:${tenantId}`;
}

export function typingKey(channelId: string, userId: string): string {
  return `im:typing:${channelId}:${userId}`;
}

export function presenceKey(tenantId: string, userId: string): string {
  return `im:presence:${tenantId}:${userId}`;
}

export type ImRealtimeEvent =
  | { kind: 'message.new'; channelId: string; message: ImMessageDTO }
  | { kind: 'message.updated'; channelId: string; message: ImMessageDTO }
  | { kind: 'message.deleted'; channelId: string; messageId: string }
  | {
      kind: 'reaction.changed';
      channelId: string;
      messageId: string;
      reactions: ImMessageDTO['reactions'];
    }
  | { kind: 'channel.updated'; channelId: string }
  | { kind: 'channel.member_joined'; channelId: string; userId: string }
  | { kind: 'channel.member_left'; channelId: string; userId: string }
  | { kind: 'typing.start'; channelId: string; userId: string; name: string }
  | { kind: 'typing.stop'; channelId: string; userId: string }
  | { kind: 'presence.changed'; presence: ImPresence }
  | {
      kind: 'unread.changed';
      channelId: string;
      unreadCount: number;
      mentionCount: number;
      totalUnread: number;
      totalMentions: number;
    }
  | { kind: 'mention.new'; channelId: string; channelName: string; messageId: string; body: string; senderName: string | null };

export type ImRealtimeEventKind = ImRealtimeEvent['kind'];
