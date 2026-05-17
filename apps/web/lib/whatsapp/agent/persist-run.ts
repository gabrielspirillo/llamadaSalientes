import 'server-only';

import { db } from '@/lib/db/client';
import { whatsappAgentRuns } from '@/lib/db/schema';

import type { AgentRunRecord } from './types';

/**
 * Persiste un AgentRunRecord en `whatsapp_agent_runs`.
 *
 * Idempotente: el UNIQUE (conversation_id, trigger_message_id) bloquea
 * inserciones duplicadas cuando Inngest reintenta el job o un webhook se
 * dispara dos veces. En esos casos `onConflictDoNothing` devuelve filas
 * vacías y el caller obtiene `null`.
 *
 * Multi-tenant: el caller pasa `tenantId` y la fila se inserta con ese
 * scope. RLS se activará en Fase 7.
 */
export async function writeAgentRun(record: AgentRunRecord): Promise<{ id: string } | null> {
  const rows = await db
    .insert(whatsappAgentRuns)
    .values({
      tenantId: record.tenantId,
      conversationId: record.conversationId,
      triggerMessageId: record.triggerMessageId,
      responseMessageId: record.responseMessageId,
      agent: record.agent,
      model: record.model,
      intent: record.intent,
      // Drizzle numeric: aceptamos number, lo serializa a string.
      intentConfidence: record.intentConfidence != null ? record.intentConfidence.toFixed(2) : null,
      intentReasoning: record.intentReasoning,
      handoff: record.handoff,
      urgent: record.urgent,
      tokensIn: record.tokensIn,
      tokensOut: record.tokensOut,
      latencyMs: record.latencyMs,
      fallbackUsed: record.fallbackUsed,
      toolsCalled: record.toolsCalled as never,
      errorText: record.errorText,
      traceId: record.traceId,
    })
    .onConflictDoNothing({
      target: [whatsappAgentRuns.conversationId, whatsappAgentRuns.triggerMessageId],
    })
    .returning({ id: whatsappAgentRuns.id });

  return rows[0] ?? null;
}
