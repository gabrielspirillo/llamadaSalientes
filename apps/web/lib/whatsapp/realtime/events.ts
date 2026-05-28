import type { whatsappMessages } from '@/lib/db/schema';

export type WhatsappMessageRow = typeof whatsappMessages.$inferSelect;

// Subset del row de mensaje, serializable a JSON (Dates → ISO strings) y con
// solo los campos que la UI del inbox necesita. Mantener en sync con
// page.tsx render — agregar campo acá si lo querés mostrar en realtime.
export interface SerializedWhatsappMessage {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  senderType: string;
  senderUserId: string | null;
  internalNote: boolean;
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  deliveryStatus: string | null;
  createdAt: string;
}

export function serializeMessage(row: WhatsappMessageRow): SerializedWhatsappMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction as 'INBOUND' | 'OUTBOUND',
    type: row.type,
    senderType: row.senderType,
    senderUserId: row.senderUserId,
    internalNote: row.internalNote,
    contentText: row.contentText,
    mediaUrl: row.mediaUrl,
    mediaType: row.mediaType,
    deliveryStatus: row.deliveryStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

// Eventos que viajan por el canal Redis y se reemiten por SSE al browser.
export type WhatsappRealtimeEvent =
  | { kind: 'message'; message: SerializedWhatsappMessage }
  | { kind: 'typing.start' }
  | { kind: 'typing.stop' };

export function conversationChannel(conversationId: string): string {
  return `wa:conv:${conversationId}`;
}
