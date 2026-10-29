import 'server-only';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappConversations, whatsappMessages } from '@/lib/db/schema';
import type { QueueJobs } from '@/lib/queue/queues';
import { processInboundMessages } from '@/lib/whatsapp/agent/multimodal';
import { persistOutboundEcho } from '@/lib/whatsapp/persist';
import { resolveConnector } from './whatsapp-process';

/** Lo que tarda el asistente en contestar una ráfaga: durante ese rato se calla. */
const HUMAN_REPLY_PAUSE_MS = 2 * 3600_000;

/**
 * Un mensaje que salió del teléfono de la clínica. Va retardado unos segundos
 * para que, si lo mandó la propia app (agente, recepción, recordatorio), su
 * fila con ese externalId ya esté guardada y no se duplique.
 */
export async function processWhatsappEchoJob(
  data: QueueJobs['wa-echo'],
): Promise<{ ok: boolean; reason?: string }> {
  const [already] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, data.message.tenantId),
        eq(whatsappMessages.externalId, data.message.providerMessageId),
      ),
    )
    .limit(1);
  if (already) return { ok: false, reason: 'sent_by_app' };

  const persisted = await persistOutboundEcho({
    ...data.message,
    timestamp: new Date(data.message.timestamp),
  });
  if (!persisted.message) return { ok: false, reason: 'duplicate' };

  // Alguien del equipo está contestando desde el móvil: el asistente se calla
  // un rato para no pisarle la conversación (retoma solo al vencer).
  const conv = persisted.conversation;
  if (conv.status !== 'CLOSED') {
    await db
      .update(whatsappConversations)
      .set({
        status: 'HANDOFF',
        humanTakeoverAt: new Date(),
        humanTakeoverUntil: new Date(Date.now() + HUMAN_REPLY_PAUSE_MS),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappConversations.id, conv.id),
          eq(whatsappConversations.tenantId, data.message.tenantId),
        ),
      );
  }

  // Audio, foto o documento: se descarga, se guarda y (audio) se transcribe,
  // igual que lo que manda el paciente, para que se vea y se oiga en el chat.
  if (persisted.message.type !== 'TEXT') {
    const connector = await resolveConnector(data.message.tenantId);
    await processInboundMessages({
      tenantId: data.message.tenantId,
      conversationId: conv.id,
      messages: [persisted.message],
      connector,
    }).catch((err) => console.warn('[wa-echo] media no procesada', (err as Error).message));
  }
  return { ok: true };
}
