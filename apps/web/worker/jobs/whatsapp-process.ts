import 'server-only';
import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  clinicSettings,
  tenants,
  whatsappAgentRuns,
  whatsappConnections,
  whatsappConversations,
  whatsappMessages,
} from '@/lib/db/schema';
import { updateLeadMemory } from '@/lib/memory/lead-memory';
import { acquireLock } from '@/lib/queue/lock';
import type { QueueJobs } from '@/lib/queue/queues';
import type { StepRunner } from '@/lib/queue/step';
import { localDateKey, localParts, parseDateKey, zonedToUtc } from '@/lib/tasks/tz';
import { runWhatsappAgent } from '@/lib/whatsapp/agent';
import { processInboundMessages } from '@/lib/whatsapp/agent/multimodal';
import { writeAgentRun } from '@/lib/whatsapp/agent/persist-run';
import type { AgentInput, AgentOutput, HistoryTurn } from '@/lib/whatsapp/agent/types';
import { syncWhatsappContactAvatar } from '@/lib/whatsapp/contacts/sync-avatar';
import { syncWhatsappContactWithGhl } from '@/lib/whatsapp/contacts/sync-ghl';
import { buildConnector } from '@/lib/whatsapp/factory';
import {
  LAG_THRESHOLD_MS,
  NIGHT_DEFER_LAG_MS,
  inboundLagMs,
  isQuietMinute,
  lateMessageNote,
} from '@/lib/whatsapp/health-model';
import { notifyProfessionalOfDerivation } from '@/lib/whatsapp/notify-professional';
import { sendAgentResponse } from '@/lib/whatsapp/outbound/send-response';
import { publishTypingStart, publishTypingStop } from '@/lib/whatsapp/realtime/publisher';
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

type WhatsappJobResult = {
  ok: boolean;
  reason?: string;
  intent?: string | null;
  handoff?: boolean;
  urgent?: boolean;
};

// Techo por encima del peor caso realista (LLM + envío + persistencia). Si el
// job muere sin liberar, el lock caduca solo y la conversación se destraba.
const CONVERSATION_LOCK_TTL_MS = 120_000;

/**
 * Serializa el procesamiento por conversación.
 *
 * `alreadyProcessed` (paso 2) es un read-then-act contra `whatsapp_agent_runs`
 * y esa fila recién se escribe en el paso 9, después de llamar al LLM y de
 * enviar la respuesta. Con concurrency 2, una ráfaga de mensajes hacía que dos
 * jobs vieran la conversación libre y le mandaran DOS respuestas al paciente.
 *
 * Si otro job la tiene tomada lanzamos para que BullMQ reintente: cuando el
 * reintento entre, el primero ya escribió su run y `alreadyProcessed` corta
 * limpio. El batch del primer job ya incluye los mensajes de la ráfaga, así
 * que no se pierde nada.
 */
/**
 * Otro job está contestando esta conversación. No es un fallo: el worker
 * aplaza el job unos segundos SIN gastar intentos (`DelayedError`). Antes se
 * lanzaba un Error normal, se agotaban los 3 intentos en ~6 s mientras el otro
 * job seguía con el LLM, y el aviso de "no pudo contestar" saltaba en falso.
 */
export class ConversationBusyError extends Error {
  constructor(conversationId: string) {
    super(`Conversación ${conversationId} en proceso por otro job; reintentar`);
    this.name = 'ConversationBusyError';
  }
}

/** El job se aplaza hasta `until` (mensaje atrasado que llega de noche). */
export class DeferJobError extends Error {
  constructor(readonly until: Date) {
    super(`Aplazado hasta ${until.toISOString()}`);
    this.name = 'DeferJobError';
  }
}

/** Más viejo que esto, el asistente no contesta solo: lo ve el equipo. */
const STALE_NO_REPLY_MS = 12 * 3_600_000;

/** Hora de inicio de las respuestas y fin de la noche, en hora local de la clínica. */
const DAY_START_MINUTE = 8 * 60;

/** Cuándo se escribió un entrante (Evolution trae `messageTimestamp`). */
export function writtenAtOf(row: { rawJson: unknown; createdAt: Date }): Date | null {
  const raw = row.rawJson as { messageTimestamp?: unknown } | null;
  const ts = Number(raw?.messageTimestamp);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts * 1000);
}

async function channelDelayed(tenantId: string): Promise<boolean> {
  const { getChannelProblem } = await import('@/lib/whatsapp/health');
  return (await getChannelProblem(tenantId)) === 'DELAYED';
}

async function tenantTimezone(tenantId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: clinicSettings.timezone })
    .from(clinicSettings)
    .where(eq(clinicSettings.tenantId, tenantId))
    .limit(1);
  return row?.timezone || 'Europe/Madrid';
}

/**
 * Un mensaje que llega muy tarde (el canal estuvo caído) y de noche no se
 * contesta en el acto: del 11 al 12/11 el asistente escribió a familias a las
 * 04:00 contestando lo que habían preguntado a las 19:00. Se aplaza a las
 * 08:00. Lo que se escribe de noche y llega a tiempo se contesta como siempre:
 * la familia está despierta esperando.
 */
async function nightDeferral(data: QueueJobs['wa-process'], now: Date): Promise<Date | null> {
  const [msg] = await db
    .select({ rawJson: whatsappMessages.rawJson, createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(eq(whatsappMessages.tenantId, data.tenantId), eq(whatsappMessages.id, data.messageId)),
    )
    .limit(1);
  if (!msg) return null;
  const lag = inboundLagMs(writtenAtOf(msg), now);
  if (lag === null || lag < NIGHT_DEFER_LAG_MS) return null;
  const tz = await tenantTimezone(data.tenantId);
  const p = localParts(now, tz);
  if (!isQuietMinute(p.hour * 60 + p.minute)) return null;
  // Sólo si el CANAL va con retraso (varias familias a la vez). Un mensaje
  // suelto que llega tarde (sin cobertura, reloj del móvil mal) se contesta
  // como siempre.
  if (!(await channelDelayed(data.tenantId))) return null;
  // Las 08:00 de hoy si aún no han llegado; si no (23:xx), las de mañana.
  const today = parseDateKey(localDateKey(now, tz));
  if (!today) return null;
  let until = zonedToUtc(today.year, today.month, today.day, DAY_START_MINUTE / 60, 0, tz);
  if (until <= now) {
    const tomorrow = parseDateKey(localDateKey(new Date(now.getTime() + 20 * 3_600_000), tz));
    if (!tomorrow) return null;
    until = zonedToUtc(tomorrow.year, tomorrow.month, tomorrow.day, DAY_START_MINUTE / 60, 0, tz);
  }
  return until;
}

export async function processWhatsappJob(
  data: QueueJobs['wa-process'],
  step: StepRunner,
): Promise<WhatsappJobResult> {
  const deferUntil = await nightDeferral(data, new Date()).catch(() => null);
  if (deferUntil) throw new DeferJobError(deferUntil);
  const lock = await acquireLock(`wa-conv:${data.conversationId}`, CONVERSATION_LOCK_TTL_MS);
  if (!lock) throw new ConversationBusyError(data.conversationId);
  try {
    return await runWhatsappJob(data, step);
  } finally {
    await lock.release();
  }
}

async function runWhatsappJob(
  data: QueueJobs['wa-process'],
  step: StepRunner,
): Promise<WhatsappJobResult> {
  const { tenantId, conversationId, contactPhoneE164 } = data;
  // Clínica archivada: el asistente no contesta a nadie.
  const { isTenantArchived } = await import('@/lib/tenants/archive');
  if (await isTenantArchived(tenantId)) {
    console.log('[wa-process] clínica archivada, no se responde', { tenantId, conversationId });
    return { ok: false, reason: 'tenant_archived' };
  }
  const agentEnabled = process.env.WHATSAPP_AGENT_ENABLED === 'true';
  console.log('[wa-process] job recibido', {
    tenantId,
    conversationId,
    contactPhoneE164,
    agentEnabled,
  });
  if (!agentEnabled) {
    console.warn(
      '[wa-process] salida temprana feature_disabled: WHATSAPP_AGENT_ENABLED != "true". ' +
        'El worker no invoca al LLM y el bot no responde. ' +
        'Seteá WHATSAPP_AGENT_ENABLED=true en el servicio cliniq-worker.',
    );
    return { ok: false, reason: 'feature_disabled' };
  }

  // 1. Cargar conversación.
  const gate = await step.run('gate-check', async () => {
    const rows = await db
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, conversationId))
      .limit(1);
    const conv = rows[0];
    if (!conv) return { ok: false as const, skipAgent: true, reason: 'conversation_not_found' };
    // AI-first: el agente responde SIEMPRE salvo que (a) la conversación
    // esté cerrada, (b) el operador haya pausado la IA (aiEnabled=false — lo
    // setea también un handoff pedido por la propia IA), o (c) haya una
    // ventana de takeover humano vigente (la IA retoma sola al expirar).
    // El status HANDOFF "pegado" ya NO bloquea para siempre.
    const takeoverActive =
      !!conv.humanTakeoverUntil && new Date(conv.humanTakeoverUntil) > new Date();
    const agentBlocked = conv.status === 'CLOSED' || !conv.aiEnabled || takeoverActive;
    const reason =
      conv.status === 'CLOSED'
        ? 'status_CLOSED'
        : !conv.aiEnabled
          ? 'ai_disabled'
          : 'human_takeover_active';
    return {
      ok: true as const,
      skipAgent: !!agentBlocked,
      reason: agentBlocked ? reason : undefined,
      contactId: conv.contactId,
      channel: conv.channel,
      context: (conv.context ?? {}) as Record<string, unknown>,
    };
  });
  if (!gate.ok) {
    console.warn('[wa-process] gate bloqueó (conversación)', {
      conversationId,
      reason: gate.reason,
    });
    return { ok: false, reason: gate.reason };
  }

  // 1.5. Sincronizar el contacto con GHL (CRM externo). Corre siempre que
  // exista la conv — incluso si el agente está bloqueado (HANDOFF, AI
  // disabled) — para que el sidebar muestre el match en el inbox. La
  // función es idempotente: si el contact ya tiene ghl_contact_id sale en
  // O(1) sin tocar la API. Si GHL no está conectado o falla, devuelve
  // null y seguimos sin romper el job.
  await step.run('sync-ghl-contact', async () => {
    const result = await syncWhatsappContactWithGhl(tenantId, gate.contactId);
    return result ? { ghlContactId: result.ghlContactId, created: result.created } : null;
  });

  // 2. Cargar mensajes inbound a procesar (desde el último run de la conv).
  const batch = await step.run('load-inbound-batch', async () => {
    return loadInboundBatch(tenantId, conversationId);
  });
  if (!batch.messages.length) {
    console.warn('[wa-process] sin mensajes inbound para procesar', { conversationId });
    return { ok: false, reason: 'no_inbound_messages' };
  }
  if (batch.alreadyProcessed) {
    console.log('[wa-process] batch ya procesado (otro job de la ráfaga lo tomó)', {
      conversationId,
      lastMessageId: batch.lastMessageId,
    });
    return { ok: false, reason: 'already_processed' };
  }

  // Lo más reciente de la ráfaga se escribió hace más de 12 h: llega por una
  // resincronización de WhatsApp (al volver a vincular, o tras una caída
  // larga). Contestar ahora a "¿tenéis hueco mañana?" de hace dos días haría
  // más daño que bien: se pasa al equipo, que ve el chat entero.
  const stale = await step.run('stale-check', async () => {
    const last = batch.messages[batch.messages.length - 1];
    if (!last) return false;
    const lag = inboundLagMs(
      writtenAtOf({ rawJson: last.rawJson, createdAt: new Date(last.createdAt) }),
      new Date(),
    );
    return lag !== null && lag > STALE_NO_REPLY_MS && (await channelDelayed(tenantId));
  });
  if (stale) {
    await step.run('stale-handoff', async () => {
      await onWhatsappJobGaveUp(
        { ...data, messageId: batch.lastMessageId },
        new Error('mensaje de hace más de 12 h (WhatsApp lo entregó tarde): contestar a mano'),
        { reason: 'guardrail: stale_message' },
      );
      return { ok: true };
    });
    return { ok: false, reason: 'stale_message' };
  }

  // 3. Resolver connector. NO envolver en step.run: el caché de step.run
  //    serializa a JSON y destruye los métodos de la instancia.
  const connector = await resolveConnector(tenantId);
  console.log('[wa-process] connector resuelto', {
    tenantId,
    hasConnector: !!connector,
    inboundCount: batch.messages.length,
  });

  // 3.5. Asegurar avatar del contacto (solo Evolution implementa fetch).
  // Idempotente: si ya hay avatar_url o el channel no lo soporta, sale.
  await step.run('sync-avatar', async () => {
    const result = await syncWhatsappContactAvatar({
      contactId: gate.contactId,
      phoneE164: contactPhoneE164,
      connector,
    });
    return result;
  });

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
    console.warn('[wa-process] agente bloqueado tras multimodal (no responde)', {
      conversationId,
      reason: gate.reason,
    });
    return { ok: false, reason: gate.reason };
  }

  // 5. Historial breve para contexto del LLM.
  const { turns: history, lastAt } = await step.run('load-history', async () => {
    return loadHistory(conversationId, batch.firstMessageCreatedAt);
  });
  // Sin mensajes en las últimas horas es una conversación nueva: el asistente
  // se vuelve a presentar.
  const newSession =
    !lastAt ||
    new Date(batch.firstMessageCreatedAt).getTime() - new Date(lastAt).getTime() >
      NEW_SESSION_GAP_MS;

  const triggerMessageId = batch.lastMessageId;
  const remindersResume = readRemindersResume(gate.context);
  // ¿La ráfaga se escribió hace rato? (canal con retraso). Se le dice al
  // asistente cuándo, para que "hoy a las 19:00" no se lea como el día de hoy.
  const lateNotice = await step.run('late-notice', async () => {
    const first = batch.messages[0];
    if (!first) return null;
    const writtenAt = writtenAtOf({
      rawJson: first.rawJson,
      createdAt: new Date(first.createdAt),
    });
    const lag = inboundLagMs(writtenAt, new Date());
    if (!writtenAt || lag === null || lag < LAG_THRESHOLD_MS) return null;
    if (!(await channelDelayed(tenantId))) return null;
    const tz = await tenantTimezone(tenantId);
    const label = writtenAt.toLocaleString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
    return lateMessageNote(`el ${label}`);
  });
  const agentInput: AgentInput = {
    tenantId,
    conversationId,
    contactId: gate.contactId,
    contactPhoneE164,
    userText: multimodal.combinedText,
    history,
    triggerMessageId,
    newSession,
    remindersResume,
    lateNotice,
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
    //
    // Una consulta derivada también puede venir marcada como urgente, y ahí el
    // aviso al equipo lo da el bloque de abajo con el parte entero. Publicar
    // además la tarjeta de handoff dejaría dos avisos de lo mismo en el chat,
    // uno de ellos sin el detalle. El flag de urgencia sí se marca igual: es lo
    // que hace que el inbox la priorice.
    const avisarComoHandoff =
      agentOutput.handoff || (agentOutput.urgent && !agentOutput.derivation);
    if (agentOutput.handoff || agentOutput.urgent) {
      await step.run('apply-handoff-flags', async () => {
        await applyHandoffFlags(conversationId, {
          handoff: agentOutput.handoff,
          urgent: agentOutput.urgent,
        });
      });
    }
    if (avisarComoHandoff) {
      // El agente soltó la conversación: alguien del equipo tiene que cerrarla.
      await step.run('create-handoff-task', async () => {
        const { onWhatsappHandoff } = await import('@/lib/tasks/hooks');
        await onWhatsappHandoff({ tenantId, conversationId });
        return { ok: true };
      });
      // Mensajes: además de la tarea, la tarjeta en el chat con las últimas
      // líneas y el botón para tomarla. Best-effort, nunca rompe el job.
      await step.run('publish-handoff-event', async () => {
        try {
          const { postWhatsappHandoff } = await import('@/lib/messaging/bot');
          const { resolveConversationSpecialists } = await import('@/lib/agenda/specialist');
          const specialists = await resolveConversationSpecialists(tenantId, conversationId).catch(
            () => [],
          );
          await postWhatsappHandoff({
            tenantId,
            conversationId,
            patientName: `Contacto ${contactPhoneE164}`,
            phone: contactPhoneE164,
            lastLines: [agentInput.userText, agentOutput.responseText]
              .filter((l): l is string => Boolean(l?.trim()))
              .map((l) => l.trim().slice(0, 200)),
            specialistNames: specialists.map((s) => s.fullName),
            mentionUserIds: specialists
              .map((s) => s.userId)
              .filter((id): id is string => Boolean(id)),
          });
        } catch (err) {
          console.warn('[wa-process] publish-handoff-event falló', (err as Error).message);
        }
        return { ok: true };
      });
    }

    // 7 bis. Modo DERIVE: el asistente recopiló la consulta y le toca a un
    // profesional. El aviso sale ANTES de contestarle al paciente: lo que se le
    // dice es que ya está avisado, y conviene que sea verdad.
    const derivation = agentOutput.derivation;
    if (derivation) {
      const notified = await step.run('notify-professional', async () => {
        const [tenantRow] = await db
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        const result = await notifyProfessionalOfDerivation({
          tenantId,
          clinicName: tenantRow?.name ?? 'la clínica',
          derivation,
          // La conversación del paciente: es la clave del cerrojo contra el
          // doble aviso si el modelo re-deriva la misma consulta.
          sourceConversationId: conversationId,
          connector,
        }).catch((err) => {
          // Nunca debería lanzar, pero si lo hace, la consulta igual tiene que
          // quedar registrada: sigue el resto de los pasos.
          console.warn('[wa-process] notify-professional falló', (err as Error).message);
          return { sent: false, reason: 'excepcion' };
        });
        console.log('[wa-process] derivación', {
          conversationId,
          via: derivation.via,
          professionalName: derivation.professionalName,
          sent: result.sent,
          reason: 'reason' in result ? result.reason : undefined,
        });
        return result.sent;
      });

      // La tarjeta en el chat interno y la tarea: son la red que hace que una
      // consulta derivada no dependa de que el profesional mire el móvil.
      await step.run('publish-derivation-event', async () => {
        try {
          const { postWhatsappDerivation } = await import('@/lib/messaging/bot');
          await postWhatsappDerivation({
            tenantId,
            conversationId,
            patientName: derivation.patientName ?? `Contacto ${contactPhoneE164}`,
            phone: contactPhoneE164,
            professionalName: derivation.professionalName,
            treatmentName: derivation.treatmentName,
            summary: derivation.summary,
            preferredTime: derivation.preferredTime,
            urgent: derivation.urgent,
            viaFallback: derivation.via === 'respaldo',
            notified,
          });
        } catch (err) {
          console.warn('[wa-process] publish-derivation-event falló', (err as Error).message);
        }
        return { ok: true };
      });

      await step.run('create-derivation-task', async () => {
        const { onWhatsappHandoff } = await import('@/lib/tasks/hooks');
        await onWhatsappHandoff({ tenantId, conversationId });
        return { ok: true };
      });
    }

    // 8. Enviar outbound (si hay connector y respuesta).
    let responseMessageId: string | null = null;
    const responseText = agentOutput.responseText;
    console.log('[wa-process] agente terminó', {
      conversationId,
      hasResponseText: !!responseText,
      responseChars: responseText?.length ?? 0,
      intent: agentOutput.intent,
      handoff: agentOutput.handoff,
      hasConnector: !!connector,
      fallbackUsed: agentOutput.fallbackUsed,
      errorText: agentOutput.errorText ?? null,
    });
    if (connector && responseText) {
      responseMessageId = await step.run('send-outbound', async () => {
        // Reintento del job con el mensaje ya enviado (el proveedor lo entregó
        // y falló lo de después): el 6/11 una familia recibió dos veces la
        // misma lista de huecos, una de ellas DESPUÉS de reservar, y volvió a
        // elegir. Si ya hay un saliente idéntico desde que empezó la ráfaga, no
        // se manda otra vez.
        const [dup] = await db
          .select({ id: whatsappMessages.id })
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.tenantId, tenantId),
              eq(whatsappMessages.conversationId, conversationId),
              eq(whatsappMessages.direction, 'OUTBOUND'),
              eq(whatsappMessages.contentText, responseText),
              gt(whatsappMessages.createdAt, batch.firstMessageCreatedAt),
            ),
          )
          .limit(1);
        if (dup) {
          console.warn('[wa-process] outbound idéntico ya enviado, no se repite', {
            conversationId,
          });
          return dup.id;
        }
        const sent = await sendAgentResponse({
          tenantId,
          conversationId,
          toPhoneE164: contactPhoneE164,
          text: responseText,
          buttons: agentOutput.responseButtons?.buttons ?? null,
          connector,
        });
        console.log('[wa-process] outbound enviado OK', {
          conversationId,
          toPhoneE164: contactPhoneE164,
          externalId: sent.externalId,
        });
        return sent.messageId;
      });
      // Guiones de la clínica tras reservar: cada uno en su propio mensaje y
      // en su propio paso, para que un reintento no repita los ya enviados.
      const extras = agentOutput.additionalTexts ?? [];
      for (let i = 0; i < extras.length; i++) {
        const text = extras[i];
        if (!text) continue;
        await step.run(`send-outbound-extra-${i}`, async () => {
          const sent = await sendAgentResponse({
            tenantId,
            conversationId,
            toPhoneE164: contactPhoneE164,
            text,
            buttons: null,
            connector,
          });
          return sent.messageId;
        });
      }
    } else {
      console.warn('[wa-process] NO se envía outbound (sin connector o sin texto)', {
        conversationId,
        hasConnector: !!connector,
        hasResponseText: !!responseText,
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

    // 10. Actualizar la memoria del lead (cross-canal, gated por módulo).
    //     Best-effort: updateLeadMemory nunca lanza; no bloquea la respuesta.
    await step.run('update-lead-memory', async () => {
      await updateLeadMemory(tenantId, contactPhoneE164);
      return { ok: true };
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
  // Lo pendiente es lo que llegó DESPUÉS del último mensaje ya contestado (el
  // disparador del último run), no después de la hora en que terminó ese run.
  // Con la hora del run, un mensaje que entraba mientras el asistente pensaba
  // la respuesta anterior (~4 al día en Respinens) quedaba fuera de todos los
  // lotes y nadie lo contestaba.
  // La comparación va en SQL: en JS la hora se redondea a milisegundos y el
  // propio disparador (con microsegundos) volvería a entrar en el lote.
  const cutoff = sql`coalesce(
    (select max(coalesce(tm.created_at, ar.created_at))
       from whatsapp_agent_runs ar
       left join whatsapp_messages tm on tm.id = ar.trigger_message_id
      where ar.conversation_id = ${conversationId}),
    now() - interval '30 minutes'
  )`;

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

const NEW_SESSION_GAP_MS = 6 * 60 * 60 * 1000;

async function loadHistory(
  conversationId: string,
  beforeOrEqual: Date,
): Promise<{ turns: HistoryTurn[]; lastAt: string | null }> {
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

  const before = rows.filter((r) => r.createdAt < new Date(beforeOrEqual));
  const turns = before
    .map<HistoryTurn>((r) => ({
      role: r.direction === 'OUTBOUND' ? 'assistant' : 'user',
      // `||`: un audio llega con contentText vacío ('') y la transcripción
      // no entraba nunca en el historial.
      content: (r.contentText || r.transcription || '').trim(),
    }))
    .filter((t) => t.content.length > 0)
    .slice(0, MAX_HISTORY_TURNS)
    .reverse();
  return {
    turns,
    lastAt: before[0]?.createdAt ? new Date(before[0].createdAt).toISOString() : null,
  };
}

export async function resolveConnector(tenantId: string): Promise<WhatsAppConnector | null> {
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

async function applyHandoffFlags(
  conversationId: string,
  flags: { handoff: boolean; urgent: boolean },
): Promise<void> {
  // Marcamos el flag de urgencia SIEMPRE que la conversación sea urgente (para
  // que el inbox la priorice), pero solo PAUSAMOS la IA (status=HANDOFF +
  // aiEnabled=false) cuando hubo un handoff real a recepción. Una urgencia que
  // la IA resolvió sola agendando la cita NO pausa el agente: sigue AI-first.
  const patch: Partial<typeof whatsappConversations.$inferInsert> = {
    urgentFlag: flags.urgent,
    updatedAt: new Date(),
  };
  if (flags.handoff) {
    // La IA escaló a un humano: la pausamos (aiEnabled=false) para que pare de
    // responder — con el gate AI-first, status por sí solo ya no frena. El
    // operador la reactiva desde el toggle "Agente Virtual".
    patch.status = 'HANDOFF';
    patch.aiEnabled = false;
  }
  await db
    .update(whatsappConversations)
    .set(patch)
    .where(eq(whatsappConversations.id, conversationId));
}

// Lee el flag remindersResume del context de la conversación. Si está
// expirado, devuelve null. Si el shape no matchea, devuelve null.
function readRemindersResume(context: Record<string, unknown>): AgentInput['remindersResume'] {
  const raw = context.remindersResume;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<NonNullable<AgentInput['remindersResume']>>;
  if (
    typeof r.reminderId !== 'string' ||
    typeof r.ghlAppointmentId !== 'string' ||
    typeof r.expiresAt !== 'string' ||
    r.action !== 'reschedule'
  ) {
    return null;
  }
  const expiresAt = new Date(r.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return null;
  }
  return {
    reminderId: r.reminderId,
    action: 'reschedule',
    ghlAppointmentId: r.ghlAppointmentId,
    expiresAt: r.expiresAt,
  };
}

/**
 * El asistente falló en todos los intentos (el modelo, una herramienta, un
 * corte de red…). Hasta el 11/11 eso sólo quedaba en el log del worker: una
 * familia contestó a la pregunta de la fiebre y nadie le respondió en más de
 * una hora sin que el equipo se enterase. Ahora queda el run con el error (lo
 * marca «Revisión del asistente») y se avisa al equipo como en un traspaso:
 * tarea + tarjeta en el chat. Al paciente no se le manda nada automático.
 * Nunca lanza.
 */
export async function onWhatsappJobGaveUp(
  data: QueueJobs['wa-process'],
  err: Error | undefined,
  opts: { reason?: string } = {},
): Promise<void> {
  // La espera por otro job no es un fallo (ver ConversationBusyError).
  if (err instanceof ConversationBusyError || /en proceso por otro job/.test(err?.message ?? '')) {
    return;
  }
  // Si otro job ya contestó un lote que incluía este mensaje, no hay nada que avisar.
  try {
    const [msg] = await db
      .select({ createdAt: whatsappMessages.createdAt })
      .from(whatsappMessages)
      .where(
        and(eq(whatsappMessages.tenantId, data.tenantId), eq(whatsappMessages.id, data.messageId)),
      )
      .limit(1);
    if (msg) {
      const [covered] = await db
        .select({ id: whatsappAgentRuns.id })
        .from(whatsappAgentRuns)
        .innerJoin(whatsappMessages, eq(whatsappMessages.id, whatsappAgentRuns.triggerMessageId))
        .where(
          and(
            eq(whatsappAgentRuns.conversationId, data.conversationId),
            gte(whatsappMessages.createdAt, msg.createdAt),
          ),
        )
        .limit(1);
      if (covered) return;
    }
  } catch (e) {
    console.warn('[wa-process] no se pudo comprobar si ya estaba contestado', (e as Error).message);
  }
  try {
    await writeAgentRun({
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      triggerMessageId: data.messageId,
      responseMessageId: null,
      agent: 'main',
      model: 'none',
      intent: null,
      intentConfidence: null,
      intentReasoning: opts.reason ?? 'guardrail: job_failed',
      handoff: true,
      urgent: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      fallbackUsed: false,
      toolsCalled: [],
      errorText: `El asistente no pudo contestar: ${(err?.message ?? 'error desconocido').slice(0, 500)}`,
      traceId: null,
    });
  } catch (e) {
    console.warn('[wa-process] no se pudo guardar el run fallido', (e as Error).message);
  }
  try {
    const { onWhatsappHandoff } = await import('@/lib/tasks/hooks');
    await onWhatsappHandoff({ tenantId: data.tenantId, conversationId: data.conversationId });
  } catch (e) {
    console.warn('[wa-process] tarea de fallo', (e as Error).message);
  }
  try {
    const { postWhatsappHandoff } = await import('@/lib/messaging/bot');
    await postWhatsappHandoff({
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      patientName: `Contacto ${data.contactPhoneE164}`,
      phone: data.contactPhoneE164,
      lastLines: ['⚠️ El asistente no pudo contestar este mensaje: respóndele desde el chat.'],
    });
  } catch (e) {
    console.warn('[wa-process] aviso de fallo', (e as Error).message);
  }
}
