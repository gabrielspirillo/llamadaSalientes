import 'server-only';

import {
  conversationChannel,
  serializeMessage,
  type WhatsappMessageRow,
  type WhatsappRealtimeEvent,
} from './events';

// Publicación de eventos de conversación al canal Redis correspondiente.
// El SSE handler (api/whatsapp/conversations/[id]/stream) está SUBSCRIBE-ado
// y reenvía al browser.
//
// Comparte conexión con BullMQ vía getRedis(): PUBLISH es un comando regular
// (no bloqueante, no entra en subscriber mode) así que es seguro mientras la
// conexión no esté en modo subscriber.
//
// Failure-mode: si Redis está caído no queremos romper el flujo principal de
// persistencia. Por eso siempre logueamos y tragamos el error. El import del
// módulo `queue/connection` es dinámico para no arrastrar la validación de
// `lib/env.ts` en archivos que se cargan desde tests sin vars completas.
async function publish(channel: string, event: WhatsappRealtimeEvent): Promise<void> {
  if (!process.env.REDIS_URL) return;
  try {
    const { getRedis } = await import('@/lib/queue/connection');
    await getRedis().publish(channel, JSON.stringify(event));
  } catch (err) {
    console.warn('[wa-realtime] publish failed', {
      channel,
      kind: event.kind,
      err: (err as Error).message,
    });
  }
}

export async function publishMessageEvent(row: WhatsappMessageRow): Promise<void> {
  // Catch wide: la realtime no debe romper el flujo principal de persistencia
  // si hay un row malformado (ej. fixture de tests sin createdAt).
  try {
    await publish(conversationChannel(row.conversationId), {
      kind: 'message',
      message: serializeMessage(row),
    });
  } catch (err) {
    console.warn('[wa-realtime] publishMessageEvent failed', {
      messageId: row.id,
      err: (err as Error).message,
    });
  }
}

export async function publishTypingStart(conversationId: string): Promise<void> {
  await publish(conversationChannel(conversationId), { kind: 'typing.start' });
}

export async function publishTypingStop(conversationId: string): Promise<void> {
  await publish(conversationChannel(conversationId), { kind: 'typing.stop' });
}
