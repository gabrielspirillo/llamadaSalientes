/**
 * Tipos del agente conversacional de WhatsApp.
 *
 * Este archivo define el "contrato" que comparten el orquestador del agente
 * (lib/whatsapp/agent/index.ts), los handlers de tools y la persistencia en
 * la tabla whatsapp_agent_runs (lib/whatsapp/agent/persist-run.ts).
 *
 * Mantener los shapes alineados con la migración 0009_whatsapp_agent_runs.sql
 * y la tabla `whatsappAgentRuns` en lib/db/schema.ts.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Intent + clasificación
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Intents que el clasificador puede asignar a la ráfaga de mensajes inbound.
 *
 * - SCHEDULING: pedir/reagendar/cancelar/consultar disponibilidad de cita.
 * - FAQ: pregunta sobre la clínica/servicios/precios/horarios sin agendar.
 * - URGENT: dolor fuerte, sangrado, urgencia clínica → handoff inmediato.
 * - HANDOFF: cualquier caso que requiere humano (sin urgencia clínica).
 * - OTHER: saludo, agradecimiento, off-topic.
 *
 * Mantener sincronizado con el enum SQL `agent_intent` (migración 0009).
 */
export const AGENT_INTENTS = ['SCHEDULING', 'FAQ', 'URGENT', 'HANDOFF', 'OTHER'] as const;
export type AgentIntent = (typeof AGENT_INTENTS)[number];

export const agentIntentSchema = z.enum(AGENT_INTENTS);

/** Si confidence < HANDOFF_CONFIDENCE_THRESHOLD forzamos handoff a recepción. */
export const HANDOFF_CONFIDENCE_THRESHOLD = 0.7;

export const intentClassificationSchema = z.object({
  intent: agentIntentSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(280),
});

export type IntentClassification = z.infer<typeof intentClassificationSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tool calls (lo que decide el LLM y lo que devuelve la tool ejecutada)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Representación de una invocación de tool por parte del LLM, ya resuelta.
 * Persistida en `whatsapp_agent_runs.tools_called` (jsonb array).
 */
export interface ToolCallTrace {
  /** Nombre canónico de la tool (ej: check_availability, book_appointment). */
  name: string;
  /** Args con los que el LLM invocó la tool (post-validación Zod). */
  args: Record<string, unknown>;
  /** true si la tool se ejecutó sin lanzar; false si hubo error. */
  ok: boolean;
  /** Texto crudo que devolvió la tool al LLM (ToolResult.result). */
  result: string;
  latencyMs: number;
  /** Mensaje de error si ok=false. */
  error?: string;
}

export const toolCallTraceSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.unknown()),
  ok: z.boolean(),
  result: z.string(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Multimodal: salida del preprocesador antes de mandarle el texto al LLM
// ─────────────────────────────────────────────────────────────────────────────

export type MediaKind = 'text' | 'audio' | 'image' | 'document' | 'video' | 'sticker' | 'unknown';

/**
 * Resumen por-mensaje del preprocesador multimodal. El array completo se
 * concatena en `combinedText` para alimentar al LLM, y cada item se cachea en
 * `whatsapp_messages.media_analysis_json` para idempotencia en retries.
 */
export interface MediaSummary {
  /** ID del mensaje inbound original (whatsapp_messages.id). */
  messageId: string;
  kind: MediaKind;
  /** Texto que se entrega al LLM (transcripción / descripción / texto original). */
  summary: string;
  /** URL si el media fue persistido en Supabase Storage (image/audio/pdf). */
  mediaUrl?: string;
  /** Modelo usado para procesar este media (whisper-1, gemini-2.5-pro, 'cache'). */
  model?: string;
  latencyMs?: number;
}

export interface MultimodalOutput {
  /** Texto unificado con marcadores [t+Ns] por mensaje. Entrada del LLM. */
  combinedText: string;
  summaries: MediaSummary[];
  totalLatencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado del agente (entrada/salida del orquestador)
// ─────────────────────────────────────────────────────────────────────────────

/** Mensaje del historial breve que se incluye en el contexto del LLM. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Entrada del agente. La construye el job de Inngest después de cargar la
 * ráfaga debounced + historial + contexto de clínica.
 */
export interface AgentInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  contactPhoneE164: string;
  /** Texto del paciente ya unificado por el preprocesador multimodal. */
  userText: string;
  /** Mensajes previos (max ~10), excluyendo notas internas. */
  history: HistoryTurn[];
  /**
   * Último mensaje inbound de la ráfaga. Se persiste como trigger_message_id
   * y es la clave de idempotencia: doble run sobre el mismo trigger lo bloquea
   * el UNIQUE de la tabla.
   */
  triggerMessageId: string;
  /**
   * Si la conversación tiene un context.remindersResume activo (el paciente
   * tocó "Reagendar" en un reminder reciente), pasamos esa metadata al
   * agente para que arranque proactivamente proponiendo slots.
   */
  remindersResume?: {
    reminderId: string;
    action: 'reschedule';
    ghlAppointmentId: string;
    expiresAt: string;
  } | null;
}

/**
 * Respuesta del agente. El job de Inngest la usa para:
 *  - Mandar `responseText` o `responseButtons` por el connector.
 *  - Marcar la conversación HANDOFF / URGENT.
 *  - Persistir `whatsapp_agent_runs` con todo el trace.
 */
export interface AgentOutput {
  intent: AgentIntent | null;
  intentConfidence: number | null;
  intentReasoning: string | null;
  /** Texto a enviar al paciente. Null si decidió no responder (handoff puro). */
  responseText: string | null;
  /** Si el LLM eligió respuesta interactiva con botones (max 3). */
  responseButtons: {
    bodyText: string;
    buttons: Array<{ id: string; title: string }>;
  } | null;
  handoff: boolean;
  urgent: boolean;
  // Telemetría del LLM call principal (post-fallback).
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  fallbackUsed: boolean;
  toolsCalled: ToolCallTrace[];
  errorText: string | null;
  traceId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistencia: argumento de writeAgentRun
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape exacto que se inserta en `whatsapp_agent_runs`. El orquestador arma
 * este objeto a partir de AgentInput + AgentOutput y se lo pasa a persist-run.
 */
export interface AgentRunRecord {
  tenantId: string;
  conversationId: string;
  triggerMessageId: string;
  responseMessageId: string | null;
  agent: string; // 'main' por ahora
  model: string;
  intent: AgentIntent | null;
  intentConfidence: number | null;
  intentReasoning: string | null;
  handoff: boolean;
  urgent: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  fallbackUsed: boolean;
  toolsCalled: ToolCallTrace[];
  errorText: string | null;
  traceId: string | null;
}
