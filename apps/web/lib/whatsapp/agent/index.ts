import 'server-only';

import { phoneHasHistory } from '@/lib/agenda/agent';
import { samePhone } from '@/lib/agenda/patients';
import { buildRoleSection, buildScriptsSection } from '@/lib/care-profile/messages';
import { type CareProfile, buildCareProtocolSection } from '@/lib/care-profile/policy';
import { GUARDIAN_ROLE_LABELS } from '@/lib/care-profile/policy';
import { getCareProfile } from '@/lib/care-profile/queries';
import {
  type WhatsappAgentRuntimeSettings,
  getWhatsappAgentSettings,
} from '@/lib/data/whatsapp-agent-settings';
import { getLeadMemory } from '@/lib/memory/lead-memory';
import { listPatientsForPhone } from '@/lib/patients/persons';
import { findPatientByPhone } from '@/lib/patients/registry';
import { getPatientInfo } from '@/lib/retell/tools';
import { type LlmCallResult, type LlmMessage, callLLM } from './llm';
import {
  HANDOFF_RESPONSE_TEXT,
  buildSystemPrompt,
  formatNowInClinicZone,
  loadGroundingForTenant,
  upcomingDaysTable,
} from './prompt';

import { toWhatsappFormatting } from '@/lib/whatsapp/format';

import { buildDerivationReply } from './derivation';

import { detectDiagnosis, detectInjection, redactPii } from './guardrails';
import {
  type AgentToolName,
  type ExecuteToolInput,
  executeAgentTool,
  getAgentToolDefinitions,
} from './tools';
import type { AgentDerivation, AgentInput, AgentIntent, AgentOutput, ToolCallTrace } from './types';

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
  /**
   * Ajustes por tenant: personalización de tono/nombre (aditiva, no anula
   * reglas) y el modo del asistente (si agenda o si deriva al profesional).
   */
  loadAgentSettings: (tenantId: string) => Promise<WhatsappAgentRuntimeSettings | null>;
  /**
   * Perfil de atención de la clínica (pediatría). Null para casi todas: el
   * prompt no cambia. Best-effort: si falla, el asistente atiende como siempre.
   */
  loadCareProfile: (tenantId: string) => Promise<CareProfile | null>;
  /**
   * Lo que la plataforma ya sabe del teléfono que escribe (ficha, hijos,
   * próxima cita). Null si es un contacto nuevo.
   */
  loadKnownContact: (tenantId: string, phoneE164: string) => Promise<string | null>;
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
  loadAgentSettings: getWhatsappAgentSettings,
  loadCareProfile: getCareProfile,
  loadKnownContact: async (tenantId, phoneE164) => {
    // Mismo texto que devuelve get_patient_info, pero ANTES de contestar: si
    // el agente lo tiene que pedir, ya ha saludado como a un desconocido y
    // pregunta datos que la clínica tiene.
    const [record, kids] = await Promise.all([
      findPatientByPhone(tenantId, phoneE164).catch(() => null),
      listPatientsForPhone(tenantId, phoneE164).catch(() => []),
    ]);
    // Todo número que escribe queda en la libreta ANTES de que conteste el
    // asistente (con el nombre de su perfil de WhatsApp, o sin nombre). Eso no
    // es "conocerle": sólo cuenta con un niño en ficha, un nombre guardado por
    // la clínica o una cita. Si no, un paciente nuevo recibía trato de
    // conocido y se saltaba el saludo y las preguntas de primera visita.
    if (!record && kids.length === 0) return null;
    const savedName = Boolean(record?.firstName?.trim() || record?.lastName?.trim());
    const hasHistory =
      kids.length > 0 ||
      savedName ||
      Boolean(record?.ghlContactId) ||
      (await phoneHasHistory(tenantId, phoneE164).catch(() => false));
    if (!hasHistory) return null;
    const info = await getPatientInfo(tenantId, { phone: phoneE164 }, { patientPhone: phoneE164 });
    // Quién escribe: el tutor cuyo teléfono es este (por su nombre en la
    // ficha), o el titular de la libreta. Es a quien hay que saludar.
    const guardian = kids
      .flatMap((k) => k.guardians)
      .find((g) => g.phone && samePhone(g.phone, phoneE164) && g.name?.trim());
    const writer = guardian
      ? `${guardian.name.trim()}${guardian.role ? ` (${GUARDIAN_ROLE_LABELS[guardian.role]?.toLowerCase() ?? guardian.role})` : ''}`
      : (record?.name ?? kids[0]?.contactName ?? null);
    return `${writer ? `Quien escribe: ${writer}.\n` : ''}${info.result}`;
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

const MAX_TOOL_ITERATIONS = 7;
/** Correcciones de la autorrevisión por turno: si a la segunda no sale, sale lo que haya. */
const MAX_NUDGES = 1;
const TEMPERATURE = 0.3;

export async function runWhatsappAgent(
  input: AgentInput,
  depsOverride: Partial<AgentRunDeps> = {},
): Promise<AgentOutput> {
  const deps: AgentRunDeps = { ...defaultAgentDeps, ...depsOverride };
  const startedAll = Date.now();

  // Grounding por-tenant: clinic settings + treatments + FAQs. La memoria del
  // lead se carga en paralelo (best-effort: si falla, seguimos sin memoria).
  const [grounding, leadMemory, agentSettings, careProfile] = await Promise.all([
    deps.loadGrounding(input.tenantId),
    deps.loadLeadMemory(input.tenantId, input.contactPhoneE164).catch(() => null),
    deps.loadAgentSettings(input.tenantId).catch(() => null),
    deps.loadCareProfile(input.tenantId).catch(() => null),
  ]);
  const knownContact = await deps
    .loadKnownContact(input.tenantId, input.contactPhoneE164)
    .catch(() => null);
  // Sin fila de ajustes, el asistente es el de siempre: una clínica que nunca
  // pasó por el panel de Futura no puede quedarse sin agendar.
  const mode = agentSettings?.mode ?? 'BOOKING';
  const system = buildSystemPrompt({
    clinic: grounding.clinic,
    treatments: grounding.treatments,
    faqs: grounding.faqs,
    professionals: grounding.professionals,
    // Lo que la clínica le enseñó desde "Entrenar al asistente". Los fixtures
    // de evals no lo traen, y ahí el prompt es el de siempre.
    lessons: grounding.lessons ?? [],
    now: formatNowInClinicZone(grounding.clinic.timezone, deps.now()),
    upcomingDays: upcomingDaysTable(grounding.clinic.timezone, deps.now()),
    finalRules: careProfile?.messageScripts ? buildRoleSection(careProfile.messageScripts) : '',
    adminOnly: Boolean(careProfile?.messageScripts?.handoff),
    remindersResume: input.remindersResume ?? null,
    leadMemory,
    persona: agentSettings?.persona ?? null,
    agentName: agentSettings?.agentName ?? null,
    contactPhoneE164: input.contactPhoneE164,
    mode,
    careProtocol: careProfile
      ? [
          buildCareProtocolSection(careProfile),
          careProfile.messageScripts ? buildScriptsSection(careProfile.messageScripts) : '',
        ]
          .filter(Boolean)
          .join('\n\n')
      : null,
    knownContact,
  });

  // Asistente administrativo: sin flag_urgent (su descripción le manda
  // preguntar por el síntoma); lo médico va a request_handoff.
  const adminOnly = Boolean(careProfile?.messageScripts?.handoff);
  const tools = getAgentToolDefinitions(mode).filter(
    (t) => !(adminOnly && t.name === 'flag_urgent'),
  );

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
  let derivation: AgentDerivation | null = null;
  // Mensajes de la clínica tras reservar (texto exacto, no del modelo).
  const clinicMessages: string[] = [];
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

  // "Gracias" a secas: la clínica tiene su respuesta y no hace falta el modelo
  // (que alguna vez lo tomaba como motivo para pasar con Raquel).
  const thanksScript = careProfile?.messageScripts?.thanks?.trim();
  const scripted = !injection.tripped && Boolean(thanksScript) && isPureThanks(input.userText);
  if (scripted && thanksScript) {
    guardrailFlags.push('clinic_thanks');
    finalText = thanksScript;
    model = 'script';
  }

  let nudges = 0;
  for (let iter = 0; !injection.tripped && !scripted && iter < MAX_TOOL_ITERATIONS; iter++) {
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

    // Sin tool-calls → texto final, salimos. Antes, una revisión de lo que
    // afirma: si dice que reservó sin haber reservado (o decide por la edad
    // sin preguntárselo al servidor), se le devuelve para que lo corrija.
    if (result.toolCalls.length === 0) {
      const correction =
        nudges < MAX_NUDGES
          ? reviewFinalText(
              result.text,
              toolsCalled,
              Boolean(careProfile),
              deps.now(),
              input.userText,
            )
          : null;
      if (correction) {
        nudges++;
        guardrailFlags.push(`self_check:${correction.code}`);
        messages.push({ role: 'assistant', content: result.text });
        messages.push({ role: 'user', content: correction.note });
        continue;
      }
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
        // Le da idempotencia a las reservas en la agenda interna: dos vueltas
        // del loop sobre la misma conversación y el mismo hueco no crean dos
        // citas.
        conversationId: input.conversationId,
        // Su WhatsApp es su teléfono: las tools lo usan para la ficha del
        // paciente y para la cita sin depender de que el modelo lo pase.
        contactPhoneE164: input.contactPhoneE164,
        mode,
        deriveFallbackPhone: agentSettings?.deriveFallbackPhone ?? null,
      });
      toolsCalled.push(trace);

      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        name: tc.name,
        content: trace.result,
      });

      if (trace.ok && tc.name === 'flag_urgent') {
        // Marcador, NO terminal: dejamos el flag urgent pero el loop sigue
        // para que el agente agende la cita de urgencia y responda él mismo.
        urgent = true;
      } else if (trace.ok && tc.name === 'request_handoff') {
        handoff = true;
        terminalHit = true;
      } else if (
        trace.ok &&
        (tc.name === 'book_appointment' || tc.name === 'confirm_appointment')
      ) {
        const msgs = trace.data?.confirmationMessages;
        if (Array.isArray(msgs)) {
          for (const m of msgs) if (typeof m === 'string' && m.trim()) clinicMessages.push(m);
        }
      } else if (trace.ok && tc.name === 'derive_to_professional') {
        // Modo DERIVE: el asistente cerró su parte. El aviso al profesional lo
        // manda el worker; aquí sólo dejamos el parte listo y la despedida.
        derivation = readDerivation(trace, input.contactPhoneE164, urgent);
        if (derivation) terminalHit = true;
      }
    }

    if (terminalHit) {
      // Las terminales las cierra el orquestador con una plantilla, no el LLM:
      // él no sabe a quién se enrutó la consulta. Descartamos su `text` final.
      finalText = derivation
        ? buildDerivationReply({
            professionalId: derivation.professionalId,
            professionalName: derivation.professionalName,
            specialty: null,
            phoneE164: derivation.phoneE164,
            treatmentName: derivation.treatmentName,
            via: derivation.via as 'treatment' | 'unico-profesional' | 'respaldo' | 'sin-destino',
          })
        : // La clínica dice con quién le pone en contacto ("con Raquel").
          careProfile?.messageScripts?.handoff?.trim() || HANDOFF_RESPONSE_TEXT;
      break;
    }
  }

  // Llegamos al límite de iteraciones sin respuesta final → handoff fallback.
  // Cubre también urgencias que no llegaron a cerrar (no se pudo agendar):
  // derivamos a recepción como red de seguridad, manteniendo el flag urgent.
  if (finalText === null) {
    handoff = true;
    finalText = HANDOFF_RESPONSE_TEXT;
    errorText = errorText ?? 'max_tool_iterations_reached';
  }

  // Guardrail de SALIDA: sobre respuestas GENERADAS por el LLM (incluye las
  // confirmaciones de cita de urgencia), no sobre la plantilla de handoff.
  if (finalText && !handoff && !derivation) {
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

  // Último paso sobre el texto: WhatsApp no entiende Markdown, así que la
  // negrita del modelo (`**así**`) llegaba al paciente con los asteriscos a la
  // vista. Va después de los guardrails para cubrir también sus plantillas.
  // Tope de servidor para el asistente administrativo: una pregunta sobre
  // síntomas no sale aunque el modelo la escriba. Se pasa a la persona del
  // equipo con el mensaje de la clínica.
  if (adminOnly && finalText && !handoff && !derivation && looksLikeMedicalQuestion(finalText)) {
    // No se deriva: se cambia por la ÚNICA pregunta permitida (fiebre de más
    // de 38,5º o dificultad para respirar) o, si ya se hizo, se sigue con la cita.
    guardrailFlags.push('admin_only:medical_question');
    const asked = input.history.some((h) => h.role === 'assistant' && /38[.,]5/.test(h.content));
    finalText = asked
      ? 'Gracias por contármelo. ¿Qué día y a qué hora te vendría bien la cita?'
      : 'Para poder darle cita solo necesito saber una cosa: ¿ahora mismo tiene fiebre de más de 38,5º o dificultad para respirar?';
  }

  // A un "hola" a secas se le contesta presentándose y preguntando en qué se
  // le ayuda; el mensaje inicial de la clínica es para cuando pide cita.
  const clinicGreeting = careProfile?.messageScripts?.greeting?.trim();
  if (
    clinicGreeting &&
    finalText &&
    !handoff &&
    isBareGreeting(input.userText) &&
    finalText.trim().startsWith(clinicGreeting.split('\n')[0]?.trim() ?? clinicGreeting)
  ) {
    guardrailFlags.push('bare_greeting');
    const agentName = agentSettings?.agentName?.trim();
    const who = agentName
      ? `${agentName}, el asistente virtual de ${grounding.clinic.name}`
      : `el asistente virtual de ${grounding.clinic.name}`;
    finalText = `Hola, soy ${who}, ¿en qué te puedo ayudar?`;
  }

  if (finalText) finalText = toWhatsappFormatting(finalText);

  // Reserva con guiones de la clínica: primero sus mensajes, tal cual, y
  // después lo que el modelo tenga que añadir (si sólo dijo "OK", nada).
  let additionalTexts: string[] = [];
  if (clinicMessages.length && !handoff && !derivation) {
    const extra = finalText?.trim() ?? '';
    const trivial = /^ok\.?$/i.test(extra) || extra === '';
    const [first, ...rest] = clinicMessages;
    finalText = first ?? finalText;
    additionalTexts = trivial ? rest : [...rest, extra];
  }

  const intent = deriveIntent({ urgent, handoff: handoff || !!derivation, toolsCalled });
  const intentConfidence = deriveConfidence({
    urgent,
    handoff: handoff || !!derivation,
    toolsCalled,
  });

  // latencyMs total: incluye carga de grounding + todas las vueltas LLM +
  // ejecución de tools. Lo persistimos como latencia "end-to-end" del run.
  const latencyMs = Date.now() - startedAll;

  return {
    intent,
    intentConfidence,
    intentReasoning: guardrailFlags.length ? `guardrail: ${guardrailFlags.join('; ')}` : null,
    responseText: finalText,
    responseButtons: null,
    additionalTexts,
    handoff,
    urgent,
    derivation,
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

/**
 * Lee el parte que dejó `derive_to_professional` en su traza.
 *
 * El destinatario lo resolvió la tool contra la base, no el modelo: aquí sólo
 * se comprueba el shape. Si viniera roto, devolvemos null y el loop sigue — el
 * asistente se despide por su cuenta y la consulta queda igual en el inbox.
 */
function readDerivation(
  trace: ToolCallTrace,
  contactPhoneE164: string,
  urgentSoFar: boolean,
): AgentDerivation | null {
  const d = trace.data;
  if (!d || typeof d.summary !== 'string' || !d.summary.trim()) return null;
  return {
    professionalId: typeof d.professionalId === 'string' ? d.professionalId : null,
    professionalName: typeof d.professionalName === 'string' ? d.professionalName : null,
    phoneE164: typeof d.phoneE164 === 'string' ? d.phoneE164 : null,
    treatmentName: typeof d.treatmentName === 'string' ? d.treatmentName : null,
    summary: d.summary.trim(),
    patientName: typeof d.patientName === 'string' ? d.patientName : null,
    preferredTime: typeof d.preferredTime === 'string' ? d.preferredTime : null,
    // El flag_urgent del propio run cuenta igual que el urgent=true de la tool:
    // el profesional tiene que ver la prisa la marque el modelo donde la marque.
    urgent: d.urgent === true || urgentSoFar,
    via: typeof d.via === 'string' ? d.via : 'sin-destino',
    // El teléfono del paciente no sale del modelo: es el del propio WhatsApp.
    patientPhoneE164: contactPhoneE164,
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

/**
 * ¿El asistente está preguntando por síntomas? Una pregunta (signo "?") que
 * habla de fiebre, tos, respiración, dolor, medicación… En el modo
 * administrativo eso no se envía nunca.
 */
export function looksLikeMedicalQuestion(text: string): boolean {
  // Sólo las frases que son pregunta: el saludo de la clínica pregunta "¿es la
  // primera vez?" y DESPUÉS avisa de la fiebre, y eso sí tiene que salir.
  const questions = text.match(/[^?\n]*\?/g) ?? [];
  return questions.some((q) => MEDICAL.test(q));
}

// Fiebre y dificultad para respirar SÍ se pueden preguntar (es lo que decide si
// se puede hacer la sesión). Lo demás no.
const MEDICAL =
  /(\btos\b|toser|s[ií]ntoma|pitid|mocos?\b|flema|v[oó]mit|diarrea|dolor|duele|medicaci[oó]n|medicamento|antibi[oó]tico|paracetamol|ibuprofeno|inhalador|saturaci[oó]n|molesti|desde cu[aá]ndo|constante|duerm|dormir|comer\b)/i;

/** "Hola", "buenas", "buenos días 😊": un saludo sin nada más. */
export function isBareGreeting(text: string): boolean {
  const t = fold(text)
    .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, '')
    .replace(/[!¡.,¿?\s]+/g, ' ')
    .trim();
  return /^(hola+|buenas+|buenos dias|buenas tardes|buenas noches|hey|ey)( (que tal|buenas|hola))?$/.test(
    t,
  );
}

// Una frase que da la cita por hecha. "Si te va bien, te la reservo" o
// "¿Te la reservo?" son ofertas y no cuentan.
const BOOKING_CLAIM =
  /\b(te (la |lo )?reservo|te (la |lo )?he (reservado|agendado)|(la |tu )?cita (queda|está|ha quedado) (reservada|agendada|confirmada)|ya (tienes|está|queda) (la cita )?(reservad|agendad)|queda(n)? reservad|reservad[ao] para)/i;
const OFFER = /\?|¿|\bsi\b|dime|prefier|quier|cuando me|conf[ií]rma/i;

const AGE_REFUSAL =
  /(m[aá]s|mayor|menor) de \d+ (años|meses)|no (le )?(podemos|puedo) (dar(le)?|atender)[^.]*(edad|años|meses)|fuera de(l)? (rango|la edad)|demasiado (pequeñ|mayor|grande)|s[oó]lo atendemos (a |de )/i;

/**
 * Autorrevisión del texto final contra lo que de verdad hicieron las tools en
 * este turno. Devuelve la nota que se le pasa al modelo para corregirse.
 */
export function reviewFinalText(
  text: string | null,
  toolsCalled: ToolCallTrace[],
  withCareProfile: boolean,
  now: Date = new Date(),
  userText = '',
): { code: string; note: string } | null {
  if (!text) return null;
  // "El 8 de noviembre es un miércoles": el día de la semana se comprueba.
  const wrongDay = findWrongWeekday(text, now);
  if (wrongDay) {
    return {
      code: 'wrong_weekday',
      note: `[Revisión interna, no la menciones] ${wrongDay}. Mira el calendario de las reglas, corrige el día (y si la clínica no abre ese día, dilo) antes de contestar.`,
    };
  }
  // Pidió un día sin huecos: hay que decírselo antes de ofrecer otro, no
  // "para el viernes tengo el martes".
  // Si se consultó hoy sin que lo pidiera (no dijo ningún día), no hay nada
  // que avisar: el aviso se lo inventaba sobre otro día.
  const lastCheck = [...toolsCalled].reverse().find((t) => t.name === 'check_availability');
  const fullDay = lastCheck?.result.match(
    /El día que pidió \((\d{4})-(\d{2})-(\d{2})\) no hay huecos libres/,
  );
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
  if (
    fullDay &&
    (`${fullDay[1]}-${fullDay[2]}-${fullDay[3]}` !== todayKey || /\bhoy\b/i.test(userText)) &&
    !/\bno (me )?(hay|tengo|queda|quedan|tenemos)\b|no hay hueco|completo|ocupad|cerrad/i.test(text)
  ) {
    const d = new Date(Date.UTC(Number(fullDay[1]), Number(fullDay[2]) - 1, Number(fullDay[3])));
    const label = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
    return {
      code: 'requested_day_full',
      note: `[Revisión interna, no la menciones] El día que pidió, ${label}, no tiene huecos (lo dice check_availability). Díselo primero con claridad ("el ${label} no me queda nada") y después ofrece las otras horas, cada una con su día de la semana correcto.`,
    };
  }
  if (/YYYY|AAAA|DD\/MM|formato/i.test(text)) {
    return {
      code: 'format_request',
      note: '[Revisión interna, no la menciones] No le pidas a la familia ningún formato de fecha: pregúntale con naturalidad (por ejemplo "¿cuándo nació?"). Tú la conviertes.',
    };
  }
  // "OK" es lo que contesta tras una reserva (los mensajes los pone la
  // clínica). Sin reserva en este turno, el paciente se queda sin nada.
  if (/^\s*ok\.?\s*$/i.test(text)) {
    const acted = toolsCalled.some(
      (t) => t.ok && (t.name === 'book_appointment' || t.name === 'confirm_appointment'),
    );
    if (!acted) {
      return {
        code: 'empty_reply',
        note: '[Revisión interna, no la menciones] Has contestado sólo "OK" y en este turno no has reservado nada: el paciente no recibe ninguna respuesta. Si ya eligió hora, llama ahora a book_appointment; si no, contéstale lo que corresponda.',
      };
    }
  }
  const booked = toolsCalled.some(
    (t) =>
      t.ok &&
      t.name === 'book_appointment' &&
      /^(Cita agendada|Esa cita ya estaba agendada)/.test(t.result),
  );
  if (!booked) {
    const claims = text
      .split(/(?<=[.!?\n])/)
      .some((sentence) => BOOKING_CLAIM.test(sentence) && !OFFER.test(sentence));
    if (claims) {
      return {
        code: 'booking_claim',
        note: '[Revisión interna, no la menciones] Has escrito que la cita está reservada, pero en este turno NO has llamado a book_appointment y la cita NO existe. Si el paciente ya eligió hora, llama ahora a book_appointment (y a register_patient antes si hace falta). Si falta algún dato, pídeselo sin decir que está reservada.',
      };
    }
  }
  // "Por la mañana tengo: 16:30, 17:15…": la franja tiene que cuadrar con la hora.
  if (/\b(por|de) la ma[ñn]ana\b/i.test(text) && !/\btarde\b/i.test(text)) {
    const hours = [...text.matchAll(/\b(\d{1,2})[:.]\d{2}\b/g)].map((m) => Number(m[1]));
    if (hours.length > 0 && hours.every((h) => h >= 14)) {
      return {
        code: 'wrong_daypart',
        note: '[Revisión interna, no la menciones] Llamas "de mañana" a horas de la tarde. Si pidió mañana y no hay, díselo claro ("por la mañana no hay; por la tarde tengo…") y ofrece esas horas como de tarde.',
      };
    }
  }
  if (withCareProfile && AGE_REFUSAL.test(text)) {
    const serverSaid = toolsCalled.some((t) => /s[oó]lo atiende/.test(t.result));
    if (!serverSaid) {
      return {
        code: 'age_guess',
        note: '[Revisión interna, no la menciones] No calcules tú la edad ni decidas si se le puede atender: llama a register_patient (o get_patient_info) con la fecha de nacimiento que dio el tutor y haz lo que diga el resultado.',
      };
    }
  }
  return null;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * Busca "martes 3 de noviembre", "el 8 de noviembre es un miércoles" y
 * parecidos, y devuelve la corrección si el día de la semana no cuadra.
 */
export function findWrongWeekday(text: string, now: Date): string | null {
  const t = fold(text);
  const wd = '(lunes|martes|miercoles|jueves|viernes|sabado|domingo)';
  const date =
    '(\\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)';
  const patterns = [
    new RegExp(`${wd},? (?:el |dia )?${date}`, 'g'),
    new RegExp(`${date},? (?:es |sera |cae )?(?:un |en )?${wd}`, 'g'),
  ];
  const nowYear = now.getUTCFullYear();
  for (const [i, re] of patterns.entries()) {
    for (const m of t.matchAll(re)) {
      const [weekday, dayStr, month] = i === 0 ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
      const monthIdx = MONTHS.indexOf(month ?? '');
      const day = Number(dayStr);
      if (monthIdx < 0 || !day || day > 31) continue;
      // Una fecha que ya pasó hace más de un mes es del año que viene.
      let year = nowYear;
      if (Date.UTC(year, monthIdx, day) < now.getTime() - 31 * 86_400_000) year += 1;
      const real = WEEKDAYS[new Date(Date.UTC(year, monthIdx, day)).getUTCDay()] ?? '';
      if (fold(real) !== weekday) {
        return `El ${day} de ${MONTHS[monthIdx]} de ${year} es ${real}, no ${weekday}`;
      }
    }
  }
  return null;
}

/** "Gracias", "muchas gracias!!", "mil gracias 😊": nada más que agradecer. */
export function isPureThanks(text: string): boolean {
  const t = fold(text)
    .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, '')
    .replace(/[!¡.,\s]+/g, ' ')
    .trim();
  return /^(muchas |mil |muchisimas )?gracia+s+( a ti| a vosotras| guapa| de nuevo| por todo)?$/.test(
    t,
  );
}
