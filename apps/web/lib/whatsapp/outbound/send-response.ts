import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import type { MessageId, WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Envía la respuesta del agente al paciente por el canal correspondiente y
 * persiste el mensaje saliente en la BD para que aparezca en el inbox.
 *
 * Llamado por el job de Inngest (whatsappProcess) después de runWhatsappAgent.
 *
 * Orden de operaciones (importante por idempotencia):
 *  1. Llamar al connector → wamid/id del provider.
 *  2. Insertar el mensaje en DB con `external_id = wamid`. Si ya existe (por
 *     un retry del job), el UNIQUE (conversation_id, external_id) hace
 *     onConflictDoNothing y devolvemos el mensaje ya creado.
 *  3. Tocar `whatsappConversations.lastMsgAt` para que el inbox ordene bien.
 *
 * Si el send falla, el caller decide: en F5 esto es una excepción que mata
 * el job; Inngest reintenta y eventualmente el primer mensaje persistido
 * (si lo hubo) dedupea.
 */

export type OutboundKind = 'text' | 'buttons';

export interface SendAgentResponseInput {
  tenantId: string;
  conversationId: string;
  /** Número del destinatario en E.164. */
  toPhoneE164: string;
  /** Cuerpo del texto (también lo lleva la variante buttons). */
  text: string;
  /** Si están presentes, se manda como interactive con botones (max 3). */
  buttons?: Array<{ id: string; title: string }> | null;
  connector: WhatsAppConnector;
}

export interface SendAgentResponseResult {
  /** ID interno del mensaje en whatsapp_messages. */
  messageId: string;
  /** ID que devolvió el provider (wamid en Cloud, key.id en Evolution, MessageSid en Twilio). */
  externalId: string;
  kind: OutboundKind;
}

export async function sendAgentResponse(
  input: SendAgentResponseInput,
): Promise<SendAgentResponseResult> {
  const useButtons = input.buttons != null && input.buttons.length > 0 && input.buttons.length <= 3;
  let sent: MessageId;
  let kind: OutboundKind;
  if (useButtons && input.buttons) {
    sent = await input.connector.sendButtons(input.toPhoneE164, input.text, input.buttons);
    kind = 'buttons';
  } else {
    sent = await input.connector.sendText(input.toPhoneE164, input.text);
    kind = 'text';
  }

  // El channel del connector usa snake_case minúsculas, el enum de DB usa
  // SCREAMING_SNAKE_CASE. Mapeo directo.
  const channelDb = mapChannelToDb(sent.channel);

  const [inserted] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      externalId: sent.id,
      direction: 'OUTBOUND',
      type: kind === 'buttons' ? 'INTERACTIVE' : 'TEXT',
      senderType: 'AGENT',
      contentText: input.text,
      // Storage del jsonb del payload del provider: lo dejamos vacío porque
      // el connector no nos lo devuelve. Si en el futuro queremos guardarlo
      // (status callbacks de Twilio, etc.) lo agregamos acá.
      rawJson: { channel: channelDb, kind } as never,
    })
    .onConflictDoNothing({
      target: [whatsappMessages.conversationId, whatsappMessages.externalId],
    })
    .returning({ id: whatsappMessages.id });

  // onConflictDoNothing devuelve [] si ya existía (retry del job). En ese
  // caso buscamos la fila existente para devolver su id.
  const messageRow =
    inserted ??
    (
      await db
        .select({ id: whatsappMessages.id })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.externalId, sent.id))
        .limit(1)
    )[0];

  if (!messageRow) {
    throw new Error(`sendAgentResponse: no se pudo persistir/recuperar el outbound ${sent.id}`);
  }

  await db
    .update(whatsappConversations)
    .set({ lastMsgAt: new Date(), updatedAt: new Date() })
    .where(eq(whatsappConversations.id, input.conversationId));

  return {
    messageId: messageRow.id,
    externalId: sent.id,
    kind,
  };
}

function mapChannelToDb(
  channel: 'whatsapp_cloud' | 'whatsapp_evolution' | 'whatsapp_twilio',
): 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO' {
  switch (channel) {
    case 'whatsapp_cloud':
      return 'WHATSAPP_CLOUD';
    case 'whatsapp_evolution':
      return 'WHATSAPP_EVOLUTION';
    case 'whatsapp_twilio':
      return 'WHATSAPP_TWILIO';
  }
}
