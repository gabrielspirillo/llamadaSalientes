import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappContacts, whatsappConversations, whatsappMessages } from '@/lib/db/schema';

import { publishMessageEvent } from './realtime/publisher';
import type { NormalizedInboundMessage } from './types';

/**
 * Upsert de contacto WhatsApp por (tenant_id, phone_e164).
 * Preferencia: si ya hay un nombre guardado, lo conservamos; sólo lo pisamos
 * cuando estaba null y llega uno nuevo.
 */
export async function upsertWhatsappContact(input: {
  tenantId: string;
  phoneE164: string;
  name: string | null;
}) {
  const [row] = await db
    .insert(whatsappContacts)
    .values({
      tenantId: input.tenantId,
      phoneE164: input.phoneE164,
      name: input.name,
    })
    .onConflictDoUpdate({
      target: [whatsappContacts.tenantId, whatsappContacts.phoneE164],
      set: {
        name: sql`coalesce(${whatsappContacts.name}, excluded.name)`,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    throw new Error('upsertWhatsappContact: no row returned');
  }
  return row;
}

/**
 * Una conversación por (contacto, canal): cada número tiene SIEMPRE el mismo
 * hilo. Se reusa la conversación más reciente del contacto; si estaba cerrada,
 * se reabre (vuelve a ACTIVE, con el agente encendido) en vez de abrir una nueva.
 * Sólo se crea si el contacto no tenía ninguna. Antes, cerrar una conversación y
 * que el paciente volviera a escribir generaba un hilo nuevo cada vez.
 */
export async function getOrCreateOpenConversation(input: {
  tenantId: string;
  contactId: string;
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
}) {
  const existing = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.tenantId, input.tenantId),
        eq(whatsappConversations.contactId, input.contactId),
        eq(whatsappConversations.channel, input.channel),
      ),
    )
    .orderBy(desc(whatsappConversations.createdAt))
    .limit(1);

  const last = existing[0];
  if (last) {
    if (last.status !== 'CLOSED') return last;
    // Reabrir el mismo hilo: el paciente volvió a escribir. Se reactiva el agente
    // y se limpia cualquier ventana de takeover vencida.
    const [reopened] = await db
      .update(whatsappConversations)
      .set({ status: 'ACTIVE', aiEnabled: true, humanTakeoverUntil: null, updatedAt: new Date() })
      .where(eq(whatsappConversations.id, last.id))
      .returning();
    return reopened ?? last;
  }

  const [created] = await db
    .insert(whatsappConversations)
    .values({
      tenantId: input.tenantId,
      contactId: input.contactId,
      channel: input.channel,
      status: 'ACTIVE',
    })
    .returning();
  if (!created) {
    throw new Error('getOrCreateOpenConversation: no row returned');
  }
  return created;
}

/**
 * Persiste un mensaje inbound a la BD, creando contact + conversation si hace
 * falta. Idempotente: si llega el mismo external_id para la misma conversación,
 * devolvemos la fila existente sin duplicar.
 */
export async function persistInboundMessage(msg: NormalizedInboundMessage) {
  const contact = await upsertWhatsappContact({
    tenantId: msg.tenantId,
    phoneE164: msg.fromPhoneE164,
    name: msg.contactName,
  });

  const conversation = await getOrCreateOpenConversation({
    tenantId: msg.tenantId,
    contactId: contact.id,
    channel: msg.channel,
  });

  const [inserted] = await db
    .insert(whatsappMessages)
    .values({
      tenantId: msg.tenantId,
      conversationId: conversation.id,
      externalId: msg.providerMessageId,
      direction: 'INBOUND',
      type: msg.type,
      senderType: 'CONTACT',
      contentText: msg.text,
      mediaUrl: null,
      mediaType: msg.mediaMimeType,
      rawJson: msg.raw as never,
    })
    .onConflictDoNothing({
      target: [whatsappMessages.conversationId, whatsappMessages.externalId],
    })
    .returning();

  // Actualizar lastMsgAt en la conversación. Solo incrementamos el contador
  // de no leídos si realmente insertamos un mensaje nuevo (no en reintentos
  // del webhook que caen en onConflictDoNothing).
  await db
    .update(whatsappConversations)
    .set({
      lastMsgAt: msg.timestamp,
      updatedAt: new Date(),
      ...(inserted ? { unreadCount: sql`${whatsappConversations.unreadCount} + 1` } : {}),
    })
    .where(eq(whatsappConversations.id, conversation.id));

  // Notificar realtime solo si insertamos fila nueva (no duplicado).
  if (inserted) {
    await publishMessageEvent(inserted);
  }

  return { contact, conversation, message: inserted ?? null };
}
