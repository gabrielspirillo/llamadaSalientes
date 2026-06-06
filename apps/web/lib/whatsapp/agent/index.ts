import 'server-only';

import { type LlmCallResult, type LlmMessage, callLLM } from './llm';
import {
  HANDOFF_RESPONSE_TEXT,
  URGENT_RESPONSE_TEXT,
  buildSystemPrompt,
  formatNowInClinicZone,
  loadGroundingForTenant,
} from './prompt';
import { getLeadMemory } from '@/lib/memory/lead-memory';

import { detectDiagnosis, detectInjection, redactPii } from './guardrails';
import {
  type AgentToolName,
  type ExecuteToolInput,
  executeAgentTool,
  getAgentToolDefinitions,
} from './tools';
import type { AgentInput, AgentIntent, AgentOutput, ToolCallTrace } from './types';

/**
 * Dependencias inyectables del orquestador. En producción usan las
 * implementaciones reales (DB + GHL + LLM). El harness de evals
 * (lib/whatsapp/agent/eval) las sustituye por fixtures + tools mockeadas +
 * un `now` fijo, para correr el agente real (mismo loop, mismo LLM) SIN
 * tocar BD, GHL ni enviar WhatsApp. Así se puede testear el prompt antes
 * de deployar.
 */
export interface AgentRunDeps {
  loadGrounding: typeof loadGroundingForTenant;
  executeTool: (input: ExecuteToolInput) => Promise<ToolCallTrace>;
  callLLM: typeof callLLM;
  now: () => Date;
  /** Memoria del lead (cross-canal) para inyectar al prompt. */
  loadLeadMemory: (
    tenantId: string,
    phoneE164: string,
  ) => Promise<{ profileSummary: string | null; facts: Record<string, unknown> } | null>;
}

const defaultAgentDeps: AgentRunDeps = {
  loadGrounding: loadGroundingForTenant,
  executeTool: executeAgentTool,
  callLLM,
  now: () => new Date(),
  loadLeadMemory: async (tenantId, phoneE164) => {
    const row = await getLeadMemory(tenantId, phoneE164);
    return row ? { profileSummary: row.profileSummary, facts: row.facts } : null;
  },
};

/**
 * Orquestador del agente conversacional de WhatsApp.
 *
 * Una invocación = una ráfaga de mensajes ya pasada por el debouncer y
 * unificada por el preprocesador multimodal (F2). Devolvemos un AgentOutput
 * con TODA la información necesaria para:
 *   - enviar la respuesta al paciente (F5),
 *   - aplicar los flags handoff/urgent a la conversación (F5),
 *   - persistir el run en whatsapp_agent_runs (writeAgentRun, F4).
 *
 * El loop tool-calling vive aquí (no en `callLLM`) para tener control
 * granular sobre las trazas, el corte por terminal-tools y el límite de
 * iteraciones. No re-implementa lógica: solo orquesta llm + tools + prompt.
 */

const MAX_TOOL_ITERATIONS = 5;
const TEMPERATURE = 0.3;

export async function runWhatsappAgent(
  input: AgentInput,
  depsOverride: Partial<AgentRunDeps> = {},
): Promise<AgentOutput> {
  const deps: AgentRunDeps = { ...defaultAgentDeps, ...depsOverride };
  const startedAll = Date.now();

  // Grounding por-tenant: clinic settings + treatments + FAQs. La memoria del
  // lead se carga en paralelo (best-effort: si falla, seguimos sin memoria).
  const [grounding, leadMemory] = await Promise.all([
    deps.loadGrounding(input.tenantId),
    deps.loadLeadMemory(input.tenantId, input.contactPhoneE164).catch(() => null),
  ]);
  const system = buildSystemPrompt({
    clinic: grounding.clinic,
    treatments: grounding.treatments,
    faqs: grounding.faqs,
    now: formatNowInClinicZone(grounding.clinic.timezone, deps.now()),
    remindersResume: input.remindersResume ?? null,
    leadMemory,
  });

  const tools = getAgentToolDefinitions();

  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    ...input.history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: input.userText },
  ];

  // Telemetría acumulada a lo largo del loop.
  const toolsCalled: ToolCallTrace[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let model = 'unknown';
  let fallbackUsed = false;
  let errorText: string | null = null;

  let finalText: string | null = null;
  let handoff = false;
  let urgent = false;
  const guardrailFlags: string[] = [];

  // Guardrail de ENTRADA: inyección de prompts / jailbreak (OWASP LLM01). Si
  // se dispara, cortamos a handoff humano SIN llamar al LLM (no dejamos que el
  // intento de inyección llegue al modelo ni gastamos tokens).
  const injection = detectInjection(input.userText);
  if (injection.tripped) {
    guardrailFlags.push(`input_injection:${injection.matched ?? ''}`);
    console.warn('[wa-agent] guardrail: inyección detectada', {
      tenantId: input.tenantId,
      matched: injection.matched,
    });
    handoff = true;
    finalText = HANDOFF_RESPONSE_TEXT;
    model = 'guardrail';
  }

  for (let iter = 0; !injection.tripped && iter < MAX_TOOL_ITERATIONS; iter++) {
    let result: LlmCallResult;
    try {
      result = await deps.callLLM({ messages, tools, temperature: TEMPERATURE });
    } catch (err) {
      errorText = (err as Error).message ?? 'llm_error';
      console.warn('[wa-agent] callLLM falló', { tenantId: input.tenantId, errorText });
      // Sin LLM no podemos seguir → handoff humano.
      handoff = true;
      finalText = HANDOFF_RESPONSE_TEXT;
      break;
    }

    tokensIn += result.tokensIn;
    tokensOut += result.tokensOut;
    model = result.model;
    if (result.fallbackUsed) fallbackUsed = true;

    // Sin tool-calls → texto final, salimos.
    if (result.toolCalls.length === 0) {
      finalText = result.text;
      break;
    }

    // Hay tool-calls: re-inyectamos la respuesta del LLM como assistant para
    // que el contexto siga coherente en la próxima vuelta.
    messages.push({
      role: 'assistant',
      content: result.text,
      toolCalls: result.toolCalls,
    });

    // Ejecutamos todas las tools de esta vuelta y guardamos sus traces.
    let terminalHit = false;
    for (const tc of result.toolCalls) {
      const trace = await deps.executeTool({
        tenantId: input.tenantId,
        toolName: tc.name,
        rawArgs: tc.args,
      });
      toolsCalled.push(trace);

      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        content: trace.result,
      });

      if (trace.ok && tc.name === 'flag_urgent') {
        urgent = true;
        handoff = true;
        terminalHit = true;
      } else if (trace.ok && tc.name === 'request_handoff') {
        handoff = true;
        terminalHit = true;
      }
    }

    if (terminalHit) {
      // El orquestador es la fuente de verdad de la respuesta plantillada.
      // El LLM no debería seguir generando — descartamos su `text` final si
      // hubiera intentado escribir uno tras llamar a la terminal.
      finalText = urgent ? URGENT_RESPONSE_TEXT : HANDOFF_RESPONSE_TEXT;
      break;
    }
  }

  // Llegamos al límite de iteraciones sin respuesta final → handoff fallback.
  if (finalText === null && !handoff && !urgent) {
    handoff = true;
    finalText = HANDOFF_RESPONSE_TEXT;
    errorText = errorText ?? 'max_tool_iterations_reached';
  }

  // Guardrail de SALIDA: solo sobre respuestas GENERADAS por el LLM, no sobre
  // los textos plantillados de handoff/urgent (que ya son seguros).
  if (finalText && !handoff && !urgent) {
    const redacted = redactPii(finalText);
    if (redacted.count > 0) {
      finalText = redacted.text;
      guardrailFlags.push(`output_pii:${redacted.count}`);
      console.warn('[wa-agent] guardrail: PII redactada', {
        tenantId: input.tenantId,
        count: redacted.count,
      });
    }
    const diag = detectDiagnosis(finalText);
    if (diag.tripped) {
      guardrailFlags.push(`output_diagnosis:${diag.matched ?? ''}`);
      console.warn('[wa-agent] guardrail: diagnóstico bloqueado', {
        tenantId: input.tenantId,
        matched: diag.matched,
      });
      handoff = true;
      finalText = HANDOFF_RESPONSE_TEXT;
    }
  }

  const intent = deriveIntent({ urgent, handoff, toolsCalled });
  const intentConfidence = deriveConfidence({ urgent, handoff, toolsCalled });

  // latencyMs total: incluye carga de grounding + todas las vueltas LLM +
  // ejecución de tools. Lo persistimos como latencia "end-to-end" del run.
  const latencyMs = Date.now() - startedAll;

  return {
    intent,
    intentConfidence,
    intentReasoning: guardrailFlags.length ? `guardrail: ${guardrailFlags.join('; ')}` : null,
    responseText: finalText,
    responseButtons: null,
    handoff,
    urgent,
    model,
    tokensIn,
    tokensOut,
    latencyMs,
    fallbackUsed,
    toolsCalled,
    errorText,
    traceId: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivación de intent + confidence a partir del comportamiento del LLM
// ─────────────────────────────────────────────────────────────────────────────

const SCHEDULING_TOOLS: ReadonlySet<AgentToolName> = new Set([
  'check_availability',
  'book_appointment',
  'cancel_appointment',
  'get_patient_info',
  'register_patient',
]);

const FAQ_TOOLS: ReadonlySet<AgentToolName> = new Set([
  'list_treatments',
  'get_treatment_details',
  'search_faqs',
]);

function deriveIntent(input: {
  urgent: boolean;
  handoff: boolean;
  toolsCalled: ToolCallTrace[];
}): AgentIntent {
  if (input.urgent) return 'URGENT';
  if (input.handoff) return 'HANDOFF';
  const successfulTools = input.toolsCalled.filter((t) => t.ok);
  // SCHEDULING gana sobre FAQ si hubo cualquier tool de scheduling (el caso
  // típico es "agenda + pregunta info" — la conversión es lo que cuenta).
  if (successfulTools.some((t) => SCHEDULING_TOOLS.has(t.name as AgentToolName))) {
    return 'SCHEDULING';
  }
  if (successfulTools.some((t) => FAQ_TOOLS.has(t.name as AgentToolName))) {
    return 'FAQ';
  }
  return 'OTHER';
}

function deriveConfidence(input: {
  urgent: boolean;
  handoff: boolean;
  toolsCalled: ToolCallTrace[];
}): number {
  // Tools terminales del propio LLM: alta confianza, las pidió él mismo.
  if (input.urgent || input.handoff) return 1.0;
  const okCount = input.toolsCalled.filter((t) => t.ok).length;
  if (okCount > 0) return 0.9;
  // Texto sin tools: el LLM respondió "de oído" — bajamos confianza para que
  // el dashboard pueda filtrar runs de baja calidad si hace falta.
  return 0.5;
}
