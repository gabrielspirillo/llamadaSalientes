import 'server-only';
import { and, asc, desc, eq, gt } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  whatsappAgentRuns,
  whatsappConnections,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { inngest } from '@/lib/inngest/client';
import { runWhatsappAgent } from '@/lib/whatsapp/agent';
import { processInboundMessages } from '@/lib/whatsapp/agent/multimodal';
import { writeAgentRun } from '@/lib/whatsapp/agent/persist-run';
import type { AgentInput, AgentOutput, HistoryTurn } from '@/lib/whatsapp/agent/types';
import { buildConnector } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Pipeline end-to-end del agente conversacional de WhatsApp.
 *
 * Trigger: evento `wa/message.received` emitido por los webhooks
 * (cloud / evolution / twilio) tras persistir cada inbound.
 *
 * Debounce: 5s por `conversationId`. Si llegan N mensajes seguidos del
 * mismo paciente, Inngest descarta los primeros y solo ejecuta esta
 * función UNA vez, con el último evento como trigger. Ahorra LLM calls y
 * permite que el procesador multimodal trate la ráfaga como un bloque.
 *
 * Gates antes de invocar al agente:
 *   - feature flag global WHATSAPP_AGENT_ENABLED=true.
 *   - conversación con status='ACTIVE'.
 *   - conversación con ai_enabled=true.
 *   - sin humanTakeoverUntil futuro (humano controlando).
 *   - mensaje trigger existente y aún no procesado por otro run.
 *
 * Idempotencia: el agent_run se inserta con UNIQUE
 * (conversation_id, trigger_message_id). Reintentos de Inngest sobre el
 * mismo mensaje se dedupean sin re-llamar al LLM (porque chequeamos al
 * principio si ya hay un run para ese trigger).
 */

const MAX_HISTORY_TURNS = 10;
const MAX_INBOUND_BATCH = 20;

type EventData = {
  tenantId: string;
  conversationId: string;
  messageId: string;
  contactPhoneE164: string;
};

export const whatsappProcess = inngest.createFunction(
  {
    id: 'wa-process',
    name: 'Procesar ráfaga de WhatsApp con agente IA',
    retries: 2,
    // Debouncer 5s por conversación: si llegan 3 mensajes en 4s, solo
    // ejecutamos UNA vez con el último como trigger.
    debounce: { key: 'event.data.conversationId', period: '5s' },
    triggers: [{ event: 'wa/message.received' }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: EventData };
    step: {
      run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    };
  }) => {
    if (process.env.WHATSAPP_AGENT_ENABLED !== 'true') {
      return { ok: false, reason: 'feature_disabled' };
    }

    const { tenantId, conversationId, contactPhoneE164 } = event.data;

    // 1. Cargar conversación + verificar gates.
    const gate = await step.run('gate-check', async () => {
      const rows = await db
        .select()
        .from(whatsappConversations)
        .where(eq(whatsappConversations.id, conversationId))
        .limit(1);
      const conv = rows[0];
      if (!conv) return { ok: false as const, reason: 'conversation_not_found' };
      if (conv.status !== 'ACTIVE') return { ok: false as const, reason: `status_${conv.status}` };
      if (!conv.aiEnabled) return { ok: false as const, reason: 'ai_disabled' };
      if (conv.humanTakeoverUntil && conv.humanTakeoverUntil > new Date()) {
        return { ok: false as const, reason: 'human_takeover_active' };
      }
      return { ok: true as const, contactId: conv.contactId, channel: conv.channel };
    });
    if (!gate.ok) return { ok: false, reason: gate.reason };

    // 2. Cargar mensajes inbound a procesar (desde el último run de la conv).
    const batch = await step.run('load-inbound-batch', async () => {
      return loadInboundBatch(tenantId, conversationId);
    });
    if (!batch.messages.length) {
      return { ok: false, reason: 'no_inbound_messages' };
    }
    if (batch.alreadyProcessed) {
      // Otro run igual ya procesó el trigger; salimos limpio.
      return { ok: false, reason: 'already_processed' };
    }

    // 3. Resolver connector. Sin conector activo no podemos descargar media
    //    ni responder; aun así corremos el agente con connector=null para
    //    persistir el intent (en handoff) y abrir conversación al humano.
    const connector = await step.run('resolve-connector', async () => {
      return resolveConnector(tenantId);
    });

    // 4. Multimodal preprocessing (Whisper/Vision + caching DB).
    const multimodal = await step.run('multimodal', async () => {
      const output = await processInboundMessages({
        tenantId,
        conversationId,
        messages: batch.messages,
        connector,
      });
      return {
        combinedText: output.combinedText,
        totalLatencyMs: output.totalLatencyMs,
      };
    });

    // 5. Historial breve para contexto del LLM.
    const history = await step.run('load-history', async () => {
      return loadHistory(conversationId, batch.firstMessageCreatedAt);
    });

    const triggerMessageId = batch.lastMessageId;
    const agentInput: AgentInput = {
      tenantId,
      conversationId,
      contactId: gate.contactId,
      contactPhoneE164,
      userText: multimodal.combinedText,
      history,
      triggerMessageId,
    };

    // 6. Correr el agente (LLM + loop tools + intent derivation).
    const agentOutput: AgentOutput = await step.run('run-agent', async () => {
      return runWhatsappAgent(agentInput);
    });

    // 7. Aplicar flags en la conversación (handoff / urgent) ANTES de enviar
    //    el outbound: si algo falla más adelante, al menos el inbox refleja
    //    el estado correcto para que el humano tome la conversación.
    if (agentOutput.handoff || agentOutput.urgent) {
      await step.run('apply-handoff-flags', async () => {
        await applyHandoffFlags(conversationId, agentOutput.urgent);
      });
    }

    // 8. Enviar outbound (si hay connector y respuesta).
    let responseMessageId: string | null = null;
    const responseText = agentOutput.responseText;
    if (connector && responseText) {
      responseMessageId = await step.run('send-outbound', async () => {
        const sent = await sendAgentResponse({
          tenantId,
          conversationId,
          toPhoneE164: contactPhoneE164,
          text: responseText,
          buttons: agentOutput.responseButtons?.buttons ?? null,
          connector,
        });
        return sent.messageId;
      });
    }

    // 9. Persistir el run completo.
    await step.run('persist-agent-run', async () => {
      await writeAgentRun({
        tenantId,
        conversationId,
        triggerMessageId,
        responseMessageId,
        agent: 'main',
        model: agentOutput.model,
        intent: agentOutput.intent,
        intentConfidence: agentOutput.intentConfidence,
        intentReasoning: agentOutput.intentReasoning,
        handoff: agentOutput.handoff,
        urgent: agentOutput.urgent,
        tokensIn: agentOutput.tokensIn,
        tokensOut: agentOutput.tokensOut,
        latencyMs: agentOutput.latencyMs,
        fallbackUsed: agentOutput.fallbackUsed,
        toolsCalled: agentOutput.toolsCalled,
        errorText: agentOutput.errorText,
        traceId: agentOutput.traceId,
      });
    });

    return {
      ok: true,
      intent: agentOutput.intent,
      handoff: agentOutput.handoff,
      urgent: agentOutput.urgent,
      responseMessageId,
      tokensIn: agentOutput.tokensIn,
      tokensOut: agentOutput.tokensOut,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (sin step.run; los llaman los step.run del handler)
// ─────────────────────────────────────────────────────────────────────────────

type InboundMessageRow = typeof whatsappMessages.$inferSelect;

async function loadInboundBatch(
  tenantId: string,
  conversationId: string,
): Promise<{
  messages: InboundMessageRow[];
  lastMessageId: string;
  firstMessageCreatedAt: Date;
  alreadyProcessed: boolean;
}> {
  // Cutoff: último agent_run de la conv (si existe). Si no, 30 minutos atrás
  // como ventana razonable para no agarrar mensajes muy antiguos.
  const lastRun = await db
    .select({ createdAt: whatsappAgentRuns.createdAt })
    .from(whatsappAgentRuns)
    .where(eq(whatsappAgentRuns.conversationId, conversationId))
    .orderBy(desc(whatsappAgentRuns.createdAt))
    .limit(1);
  const cutoff = lastRun[0]?.createdAt ?? new Date(Date.now() - 30 * 60 * 1000);

  const messages = await db
    .select()
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.tenantId, tenantId),
        eq(whatsappMessages.conversationId, conversationId),
        eq(whatsappMessages.direction, 'INBOUND'),
        gt(whatsappMessages.createdAt, cutoff),
      ),
    )
    .orderBy(asc(whatsappMessages.createdAt))
    .limit(MAX_INBOUND_BATCH);

  if (messages.length === 0) {
    return {
      messages: [],
      lastMessageId: '',
      firstMessageCreatedAt: new Date(),
      alreadyProcessed: false,
    };
  }

  const last = messages[messages.length - 1] as InboundMessageRow;
  const first = messages[0] as InboundMessageRow;

  // Si ya hay un run para este trigger, otro despertar nos ganó la carrera.
  const existing = await db
    .select({ id: whatsappAgentRuns.id })
    .from(whatsappAgentRuns)
    .where(
      and(
        eq(whatsappAgentRuns.conversationId, conversationId),
        eq(whatsappAgentRuns.triggerMessageId, last.id),
      ),
    )
    .limit(1);

  return {
    messages,
    lastMessageId: last.id,
    firstMessageCreatedAt: first.createdAt,
    alreadyProcessed: existing.length > 0,
  };
}

async function loadHistory(conversationId: string, beforeOrEqual: Date): Promise<HistoryTurn[]> {
  // Cargamos los últimos N turnos PREVIOS al primer mensaje de la ráfaga
  // actual, excluyendo notas internas. Mantenemos texto plano (sin medios).
  const rows = await db
    .select({
      direction: whatsappMessages.direction,
      senderType: whatsappMessages.senderType,
      contentText: whatsappMessages.contentText,
      transcription: whatsappMessages.transcription,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.conversationId, conversationId),
        eq(whatsappMessages.internalNote, false),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(MAX_HISTORY_TURNS * 3); // margen para filtrar después

  return rows
    .filter((r) => r.createdAt < beforeOrEqual)
    .map<HistoryTurn>((r) => ({
      role: r.direction === 'OUTBOUND' ? 'assistant' : 'user',
      content: (r.contentText ?? r.transcription ?? '').trim(),
    }))
    .filter((t) => t.content.length > 0)
    .slice(0, MAX_HISTORY_TURNS)
    .reverse();
}

async function resolveConnector(tenantId: string): Promise<WhatsAppConnector | null> {
  const rows = await db
    .select()
    .from(whatsappConnections)
    .where(
      and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.status, 'CONNECTED')),
    )
    .orderBy(desc(whatsappConnections.updatedAt))
    .limit(1);
  const conn = rows[0];
  if (!conn) return null;
  try {
    return buildConnector(conn);
  } catch (err) {
    console.warn('[wa-process] buildConnector falló', {
      tenantId,
      err: (err as Error).message,
    });
    return null;
  }
}

async function applyHandoffFlags(conversationId: string, urgent: boolean): Promise<void> {
  await db
    .update(whatsappConversations)
    .set({
      status: 'HANDOFF',
      urgentFlag: urgent,
      updatedAt: new Date(),
    })
    .where(eq(whatsappConversations.id, conversationId));
}
