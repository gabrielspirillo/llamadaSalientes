import 'server-only';
import { and, asc, desc, eq, gt } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  whatsappAgentRuns,
  whatsappConnections,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import type { StepRunner } from '@/lib/queue/step';
import type { QueueJobs } from '@/lib/queue/queues';
import { runWhatsappAgent } from '@/lib/whatsapp/agent';
import { processInboundMessages } from '@/lib/whatsapp/agent/multimodal';
import { writeAgentRun } from '@/lib/whatsapp/agent/persist-run';
import type { AgentInput, AgentOutput, HistoryTurn } from '@/lib/whatsapp/agent/types';
import { buildConnector } from '@/lib/whatsapp/factory';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import {
  publishTypingStart,
  publishTypingStop,
} from '@/lib/whatsapp/realtime/publisher';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

/**
 * Pipeline end-to-end del agente conversacional de WhatsApp.
 *
 * Trigger: job `wa-process` encolado por los webhooks (cloud / evolution /
 * twilio) tras persistir cada inbound, con `delay: 5s` por mensaje.
 *
 * Coalescing equivalente a debounce: cuando una ráfaga de N mensajes llega
 * para una misma conversación, se encolan N jobs (uno por messageId). El
 * primero que ejecuta carga TODO el batch de inbound recientes y escribe un
 * agent_run con triggerMessageId = último mensaje. Los siguientes jobs ven
 * que el último mensaje ya tiene run y salen por `alreadyProcessed`. Mismo
 * efecto neto que la debounce de Inngest (1 LLM call por ráfaga).
 *
 * Idempotencia adicional: agent_run tiene UNIQUE (conversation_id,
 * trigger_message_id) — race conditions las captura el constraint.
 */

const MAX_HISTORY_TURNS = 10;
const MAX_INBOUND_BATCH = 20;

export async function processWhatsappJob(
  data: QueueJobs['wa-process'],
  step: StepRunner,
): Promise<{
  ok: boolean;
  reason?: string;
  intent?: string | null;
  handoff?: boolean;
  urgent?: boolean;
}> {
  if (process.env.WHATSAPP_AGENT_ENABLED !== 'true') {
    return { ok: false, reason: 'feature_disabled' };
  }

  const { tenantId, conversationId, contactPhoneE164 } = data;

  // 1. Cargar conversación.
  const gate = await step.run('gate-check', async () => {
    const rows = await db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) return { ok: false as const, skipAgent: true, reason: 'conversation_not_found' };
    const agentBlocked =
      conv.status !== 'ACTIVE' ||
      !conv.aiEnabled ||
      (conv.humanTakeoverUntil && new Date(conv.humanTakeoverUntil) > new Date());
    const reason = conv.status !== 'ACTIVE'
      ? `status_${conv.status}`
      : !conv.aiEnabled
        ? 'ai_disabled'
        : 'human_takeover_active';
    return {
      ok: true as const,
      skipAgent: !!agentBlocked,
      reason: agentBlocked ? reason : undefined,
      contactId: conv.contactId,
      channel: conv.channel,
    };
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
    return { ok: false, reason: 'already_processed' };
  }

  // 3. Resolver connector. NO envolver en step.run: el caché de step.run
  //    serializa a JSON y destruye los métodos de la instancia.
  const connector = await resolveConnector(tenantId);

  // 4. Multimodal preprocessing (Whisper/Vision + caching DB).
  //    Se ejecuta SIEMPRE — incluso en HANDOFF — para que el media se
  //    descargue, suba a MinIO y se muestre en la UI del dashboard.
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

  // Si el agente está bloqueado (HANDOFF, AI disabled, etc.), salimos
  // después de procesar media para que el contenido sea visible en la UI.
  if (gate.skipAgent) {
    return { ok: false, reason: gate.reason };
  }

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

  // Indicador "escribiendo…" para el inbox del operador: emitimos desde el
  // momento que el LLM empieza a pensar hasta que terminamos de enviar el
  // outbound. El finally garantiza que se apague incluso si el agente falla.
  await publishTypingStart(conversationId);
  try {
    // 6. Correr el agente (LLM + loop tools + intent derivation).
    const agentOutput: AgentOutput = await step.run('run-agent', async () => {
      return runWhatsappAgent(agentInput);
    });

    // 7. Aplicar flags handoff/urgent ANTES de enviar outbound.
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
    };
  } finally {
    await publishTypingStop(conversationId);
  }
}

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
    .limit(MAX_HISTORY_TURNS * 3);

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
