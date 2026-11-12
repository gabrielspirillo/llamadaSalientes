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
import { localDateKey } from '@/lib/tasks/tz';
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
  lastConfirmedDate,
  relativeDayInText,
  relativeDayLabel,
  slotNotOffered,
  weekdayOf,
} from './slot-mention';
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
  const basePrompt = buildSystemPrompt({
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
  // Va lo último: es un hecho de ESTE mensaje y manda sobre la hora de arriba.
  const system = input.lateNotice?.trim()
    ? `${basePrompt}\n\n# Mensaje que llega tarde\n${input.lateNotice.trim()}`
    : basePrompt;

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
  // Y a un "hola" a secas, la presentación: siempre igual, sin el modelo.
  const scripts = careProfile?.messageScripts ?? null;
  const newSession = input.newSession ?? input.history.length === 0;
  const assistantName =
    scripts?.assistantName?.trim() ||
    (agentSettings?.agentName?.trim()
      ? `${agentSettings.agentName.trim()}, el asistente virtual de ${grounding.clinic.name}`
      : `el asistente virtual de ${grounding.clinic.name}`);
  const thanksScript = scripts?.thanks?.trim();
  let scriptedText: string | null = null;
  if (!injection.tripped && thanksScript && isPureThanks(input.userText)) {
    guardrailFlags.push('clinic_thanks');
    scriptedText = thanksScript;
  } else if (!injection.tripped && scripts && isBareGreeting(input.userText)) {
    guardrailFlags.push('bare_greeting');
    scriptedText = newSession
      ? `Hola😊, soy ${assistantName}, ¿en qué te puedo ayudar?`
      : 'Hola😊, ¿en qué te puedo ayudar?';
  }
  // Pide cita y no sabemos si ya vino: el mensaje inicial de la clínica
  // (¿es la primera vez?) sale siempre, sin que el modelo decida.
  const greetingScript = scripts?.greeting?.trim();
  if (
    scriptedText === null &&
    !injection.tripped &&
    greetingScript &&
    newSession &&
    // Se pregunta SIEMPRE, también a una familia con niños en ficha: el 5 de
    // noviembre la madre de un paciente pidió cita para la hermana pequeña y
    // el asistente, al conocer el teléfono, no preguntó y la trató como si ya
    // hubiera venido. Sólo se salta si nombra a un niño que ya está en ficha.
    !mentionsRegisteredChild(input.userText, knownContact) &&
    asksForAppointment(input.userText) &&
    !answersFirstVisit(input.userText)
  ) {
    guardrailFlags.push('clinic_greeting');
    // El guion ya empieza por "Hola😊,": se quita para no saludar dos veces.
    const rest = greetingScript.replace(/^hola\S*,?\s*/i, '');
    scriptedText = `Hola😊, soy ${assistantName}.\n\n${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
  }
  // "Quería informarme sobre las terapias": la clínica tiene su respuesta
  // (web + ofrecer cita). El catálogo con precios no se enumera.
  const infoScript = scripts?.infoRequest?.trim();
  if (
    scriptedText === null &&
    !injection.tripped &&
    infoScript &&
    // Sólo lo que acaba de escribir: en una ráfaga, el "¿me recuerdas el
    // precio?" de antes convertía un "¿me avisáis si se libera?" en el guion
    // de la web (6/11).
    asksForGeneralInfo(lastUserLine(input.userText)) &&
    !/\b(mocos|tos|catarro|fiebre|edad|meses|bebe|bebé)\b/i.test(input.userText)
  ) {
    guardrailFlags.push('clinic_info_request');
    scriptedText = newSession ? `Hola😊, soy ${assistantName}.\n\n${infoScript}` : infoScript;
  }
  const scripted = scriptedText !== null;
  if (scriptedText) {
    finalText = scriptedText;
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
              input.history.filter((h) => h.role === 'assistant').map((h) => h.content),
              careProfile
                ? [
                    knownContact ?? '',
                    ...toolsCalled
                      .filter((t) => t.name === 'get_patient_info')
                      .map((t) => t.result),
                  ].join('\n')
                : null,
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
      // La fecha de nacimiento tiene que estar ENTERA en lo que escribió la
      // familia: con "nació el 3 de junio" el modelo se inventaba el año. Y si
      // la familia la escribió completa, ESA es la fecha, pase lo que pase el
      // modelo (6/11: "15 de julio de 2026" acabó en "me falta el año").
      if (careProfile && tc.name === 'register_patient' && tc.args) {
        const said = birthDateFromTexts([
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ]);
        if (said && said !== tc.args.birth_date) {
          tc.args = { ...tc.args, birth_date: said };
          guardrailFlags.push('birth_date_from_text');
        }
      }
      if (
        careProfile &&
        tc.name === 'register_patient' &&
        tc.args &&
        tc.args.only_one_surname !== true &&
        String(tc.args.last_name ?? '')
          .trim()
          .split(/\s+/)
          .filter(Boolean).length === 1 &&
        fullNameWrittenByFamily(String(tc.args.first_name ?? ''), String(tc.args.last_name ?? ''), [
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ])
      ) {
        tc.args = { ...tc.args, only_one_surname: true };
        guardrailFlags.push('full_name_from_text');
      }
      const birth = typeof tc.args?.birth_date === 'string' ? tc.args.birth_date : '';
      const missingYear =
        careProfile &&
        tc.name === 'register_patient' &&
        /^\d{4}-\d{2}-\d{2}$/.test(birth) &&
        !birthYearSaid(birth, [
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ]);
      // Sólo se reserva una hora que la familia pidió o que el asistente le
      // ofreció. Si no, el modelo reservaba otro día por su cuenta.
      const todayKeyClinic = localDateKey(deps.now(), grounding.clinic.timezone);
      // Primera visita dicha por la familia: manda sobre lo que pase el modelo.
      if (
        careProfile &&
        tc.name === 'check_availability' &&
        tc.args &&
        tc.args.first_visit !== true &&
        conversationSaysFirstVisit([
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ])
      ) {
        tc.args = { ...tc.args, first_visit: true };
        guardrailFlags.push('first_visit_forced');
      }
      // "Es el hermano de…", "ya he acudido con otro peque": hermano de un
      // paciente, lo pase o no el modelo (6/11: quedó como 1ª visita normal).
      if (
        careProfile &&
        tc.name === 'register_patient' &&
        tc.args &&
        tc.args.sibling_of_patient !== true &&
        conversationSaysSibling([
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ])
      ) {
        tc.args = { ...tc.args, sibling_of_patient: true };
        guardrailFlags.push('sibling_forced');
      }
      // "Si hay algún hueco antes, ¿podríais avisarnos?" dicho ANTES de reservar:
      // la cita nace apuntada para adelantar. El 10/11 el asistente lo
      // prometió, no había cita que apuntar y luego reservó sin la marca.
      if (
        tc.name === 'book_appointment' &&
        tc.args &&
        tc.args.wants_earlier !== true &&
        conversationWantsEarlier([
          input.userText,
          ...input.history.filter((h) => h.role === 'user').map((h) => h.content),
        ])
      ) {
        tc.args = { ...tc.args, wants_earlier: true };
        guardrailFlags.push('wants_earlier_forced');
      }
      const notOffered =
        tc.name === 'book_appointment' && typeof tc.args?.start_time === 'string'
          ? slotNotOffered(
              tc.args.start_time,
              [input.userText, ...input.history.map((h) => h.content)],
              todayKeyClinic,
            )
          : null;
      const trace = notOffered
        ? {
            name: tc.name,
            args: tc.args,
            ok: true,
            result: `NO reservada: ${relativeDayLabel(notOffered.dateKey, todayKeyClinic)} a las ${notOffered.hhmm} no se lo has ofrecido a la familia ni lo ha pedido (${
              notOffered.missing === 'day'
                ? 'ese día no ha salido en la conversación'
                : 'esa hora no ha salido en la conversación'
            }). Ofrécele las horas que devolvió check_availability, con su día, y reserva sólo cuando elija una. Si el día que pidió no tiene hueco, díselo primero.`,
            latencyMs: 0,
          }
        : missingYear
          ? {
              name: tc.name,
              args: tc.args,
              ok: true,
              // Lo que falte, todo junto: pedirlo de a uno hace que la familia
              // repita los datos.
              result: `NO registrado: la familia no ha dicho el AÑO de nacimiento y no se puede suponer${
                String(tc.args?.last_name ?? '')
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean).length < 2 && tc.args?.only_one_surname !== true
                  ? ', y falta el segundo apellido'
                  : ''
              }. Pídele en un solo mensaje lo que falte (fecha completa con día, mes y año${
                String(tc.args?.last_name ?? '')
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean).length < 2 && tc.args?.only_one_surname !== true
                  ? ', y los dos apellidos'
                  : ''
              }) y vuelve a llamar con lo que te diga.`,
              latencyMs: 0,
            }
          : await deps.executeTool({
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

  // "Muchísimas gracias!" no es motivo para pasar con nadie: si el modelo
  // derivó un agradecimiento, sale el de la clínica.
  if (
    handoff &&
    !derivation &&
    thanksScript &&
    /gracias/i.test(input.userText) &&
    input.userText.length < 80 &&
    !/\?|hablar|llam|raquel|duda|consulta/i.test(input.userText)
  ) {
    guardrailFlags.push('thanks_not_handoff');
    handoff = false;
    finalText = thanksScript;
  }

  // Pedir mañanas tampoco: la clínica tiene su respuesta.
  const morningsScript = scripts?.mornings?.trim();
  if (
    handoff &&
    !derivation &&
    morningsScript &&
    /por la ma[ñn]ana|las ma[ñn]anas|entro a trabajar|por la tarde no/i.test(input.userText) &&
    !/hablar|raquel|duda|consulta/i.test(input.userText)
  ) {
    guardrailFlags.push('mornings_not_handoff');
    handoff = false;
    finalText = morningsScript;
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

  // Primer mensaje en un rato: el asistente dice quién es (lo pidió la
  // clínica), una vez, no en cada mensaje.
  if (
    scripts?.assistantName &&
    newSession &&
    !scripted &&
    !handoff &&
    !derivation &&
    finalText &&
    clinicMessages.length === 0 &&
    !/asistente virtual/i.test(finalText)
  ) {
    finalText = `Hola😊, soy ${assistantName}.\n\n${dropLeadingGreeting(finalText)}`;
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

  // Info de la primera visita (ayuno, duración, no duele, aparcar): al
  // OFRECER la cita de una primera visita, una vez por conversación.
  const firstVisitInfo = scripts?.dayOf?.firstVisitInfo?.trim();
  const offeredFirstVisit = toolsCalled.some(
    (t) =>
      t.name === 'check_availability' &&
      t.ok &&
      t.args?.first_visit === true &&
      /Horas libres/.test(t.result),
  );
  const infoAlreadySent = input.history.some(
    (h) =>
      h.role === 'assistant' && firstVisitInfo && h.content.includes(firstVisitInfo.slice(0, 40)),
  );
  if (
    firstVisitInfo &&
    offeredFirstVisit &&
    !infoAlreadySent &&
    !handoff &&
    !derivation &&
    finalText
  ) {
    guardrailFlags.push('first_visit_info');
    additionalTexts = [...additionalTexts, firstVisitInfo];
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
  historyAssistant: string[] = [],
  /** Lo que la agenda dice de este teléfono (get_patient_info / contexto). */
  agendaText: string | null = null,
): { code: string; note: string } | null {
  if (!text) return null;
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
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
  if (
    fullDay &&
    (`${fullDay[1]}-${fullDay[2]}-${fullDay[3]}` !== todayKey || /\bhoy\b/i.test(userText)) &&
    !/\bno (me )?(hay|tengo|queda|quedan|tenemos)\b|no hay hueco|completo|ocupad|cerrad/i.test(text)
  ) {
    const d = new Date(Date.UTC(Number(fullDay[1]), Number(fullDay[2]) - 1, Number(fullDay[3])));
    const label = relativeDayLabel(d.toISOString().slice(0, 10), todayKey);
    return {
      code: 'requested_day_full',
      note: `[Revisión interna, no la menciones] El día que pidió, ${label}, no tiene huecos (lo dice check_availability). Díselo primero con claridad ("el ${label} no me queda nada") y después ofrece las otras horas, cada una con su día de la semana correcto.`,
    };
  }
  // Instrucciones internas que se le escapan al paciente.
  if (
    /Según lo que responda|patient_id|start_time|check_availability|register_patient|book_appointment|«««|»»»|Revisión interna/.test(
      text,
    )
  ) {
    return {
      code: 'leak',
      note: '[Revisión interna, no la menciones] Tu respuesta incluye instrucciones internas o nombres de herramientas. Escríbele al paciente sólo lo que le corresponde leer.',
    };
  }
  // "Hola, soy el asistente…, ¿en qué te puedo ayudar?" cuando ya dijo lo que quería.
  if (
    /^\s*hola[,!.]?\s+soy\b[^?]{0,90}en qu[eé] (te )?puedo ayudar/i.test(text) &&
    userText &&
    !isBareGreeting(userText)
  ) {
    return {
      code: 'ignored_request',
      note: '[Revisión interna, no la menciones] El paciente ya te ha dicho lo que necesita: contéstale a eso directamente, sin volver a presentarte.',
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
  // "Veo que tiene cita hoy": la cita tiene que estar en la agenda. Cuando la
  // familia dice que tiene una que no consta, el modelo le daba la razón.
  const claimed =
    /\b(?:veo|aparece|consta|tengo)\b[^.?!]{0,30}\bcita\b[^.?!]{0,20}\b(hoy|mañana)\b|\b(?:tiene|tienes|tenéis)\s+(?:una |la |su )?cita\s+(?:para\s+)?(hoy|mañana)\b/i.exec(
      text,
    );
  if (claimed && agendaText !== null) {
    const which = (claimed[1] ?? claimed[2] ?? '').toLowerCase();
    const key = which === 'hoy' ? todayKey : addDaysKey(todayKey, 1);
    const booked = toolsCalled.some((t) => t.name === 'book_appointment' && t.ok);
    if (!booked && !agendaText.includes(key)) {
      return {
        code: 'phantom_appointment',
        note: `[Revisión interna, no la menciones] En la agenda NO hay ninguna cita ${which} para este teléfono. No digas que la ves ni la des por buena: dile que no la encuentras en la agenda y que se lo pasas a la persona del equipo para que lo revise (request_handoff).`,
      };
    }
  }
  // La clínica no quiere el catálogo con precios en el chat: para eso está la
  // web y las FAQs. Dos o más líneas con "€" es una lista de precios.
  if (withCareProfile) {
    const priceLines = text.split('\n').filter((l) => /\d\s?€|€\s?\d|\beuros?\b/i.test(l));
    if (priceLines.length >= 2) {
      return {
        code: 'price_list',
        note: '[Revisión interna, no la menciones] NO enumeres los tratamientos con sus precios. Contesta como dicen las FAQs de la clínica: la información de las sesiones está en la web (www.respinens.es) y ofrécete a buscar un hueco para el peque. Si pregunta por un precio concreto, da sólo ese dato de las FAQs.',
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
  // "El martes no me queda nada" cuando hoy es martes: se dice "hoy" (y
  // "mañana" para el de mañana). Sin número ni "que viene" detrás.
  const todayWd = weekdayOf(todayKey);
  const tomorrowWd = weekdayOf(addDaysKey(todayKey, 1));
  for (const [wd, say] of [
    [todayWd, 'hoy'],
    [tomorrowWd, 'mañana'],
  ] as const) {
    const dayNum = Number((wd === todayWd ? todayKey : addDaysKey(todayKey, 1)).slice(8, 10));
    const re = new RegExp(
      `\\bel ${wd}\\b(?:,? (?:d[ií]a )?${dayNum}\\b)?(?! \\d| que viene| pr[oó]ximo| siguiente)`,
      'i',
    );
    if (re.test(text)) {
      return {
        code: 'relative_day',
        note: `[Revisión interna, no la menciones] Hoy es ${todayWd}: "el ${wd}" se dice "${say}". Reescribe la frase con "${say}".`,
      };
    }
  }
  // "La cita es mañana" cuando quedó el jueves: se comprueba contra lo que
  // se reservó en este turno o lo último que confirmó la clínica.
  const rel = relativeDayInText(text);
  if (rel) {
    const bookedNow = toolsCalled
      .filter((t) => t.name === 'book_appointment' && t.ok)
      .map((t) => /Cita agendada: (\p{L}+), (\d{1,2}) de (\p{L}+)/u.exec(t.result))
      .find(Boolean);
    const bookedKey = bookedNow
      ? keyFromDayMonth(Number(bookedNow[2]), bookedNow[3] ?? '', todayKey)
      : /\bcita\b/i.test(text)
        ? lastConfirmedDate(historyAssistant, todayKey)
        : null;
    if (bookedKey) {
      const real = relativeDayLabel(bookedKey, todayKey);
      if (real !== rel) {
        return {
          code: 'wrong_relative_day',
          note: `[Revisión interna, no la menciones] Dices "${rel}" pero la cita es ${real} (${bookedKey}). Corrige el día; si la familia quería otro día, díselo claro y ofrécele cambiarla.`,
        };
      }
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
  // Regla 9: ni "tienes razón" ni "perdona". El 9/11 se le dio la razón a una
  // familia sobre un hueco que nunca existió.
  if (APOLOGY.test(text)) {
    return {
      code: 'apology',
      note: '[Revisión interna, no la menciones] No digas "tienes razón", "perdona", "disculpa" ni "me he equivocado". Explica lo que pasa con los datos de las herramientas (por ejemplo, que el hueco se ha ocupado) y sigue: ofrece la alternativa.',
    };
  }
  // "Sí" a "¿quieres que te mire huecos?": se buscan, no se vuelve a preguntar.
  const lastAssistant = historyAssistant[historyAssistant.length - 1] ?? '';
  if (
    isShortYes(userText) &&
    OFFERED_TO_SEARCH.test(lastAssistant) &&
    !toolsCalled.some((t) => t.name === 'check_availability')
  ) {
    return {
      code: 'search_not_done',
      note: '[Revisión interna, no la menciones] La familia ha dicho que sí a que le busques hueco: llama ahora a check_availability y enséñale las horas. No le vuelvas a preguntar.',
    };
  }
  // La misma pregunta otra vez (el 9/11 "¿es la primera vez?" tres veces).
  const asked = new Set(historyAssistant.slice(-3).flatMap(questionsOf));
  const repeated = questionsOf(text).find((q) => asked.has(q));
  if (repeated) {
    return {
      code: 'repeated_question',
      note: '[Revisión interna, no la menciones] Ya le hiciste esa misma pregunta y la familia ha contestado: usa lo que te dijo y sigue con el siguiente paso, sin volver a preguntarlo.',
    };
  }
  return null;
}

const APOLOGY =
  /\b(tienes (toda la )?raz[oó]n|perd[oó]n(a|ame)?|disculpa(me|s)?|me he equivocado|me equivoqu[eé])\b/i;
const OFFERED_TO_SEARCH =
  /\b(te (miro|busco|digo)|quieres que (te )?(mire|busque|diga)|te puedo (mirar|buscar))\b[^?]{0,80}(hueco|cita|opci|m[aá]s cercano|disponib)/i;

function isShortYes(text: string): boolean {
  const t = fold(text)
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(si|sii+|vale|ok|claro|perfecto|venga|genial|si por favor|si porfa|si gracias|por favor)$/.test(
    t,
  );
}

/** Preguntas de un texto, normalizadas, para detectar repeticiones. */
function questionsOf(text: string): string[] {
  return (text.match(/[^.!?\n¿]*\?/g) ?? [])
    .map((q) =>
      fold(q)
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((q) => q.length >= 15);
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
  // "El martes 4" sin mes: el próximo día 4 (este mes o el siguiente).
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
  const todayDay = Number(todayKey.slice(8, 10));
  const bareDay = new RegExp(`${wd},? (?:el |dia )?(\\d{1,2})\\b(?! de |:|h| y|[.,]\\d)`, 'g');
  for (const m of t.matchAll(bareDay)) {
    const day = Number(m[2]);
    if (!day || day > 31) continue;
    let y = Number(todayKey.slice(0, 4));
    let mo = Number(todayKey.slice(5, 7)) - (day >= todayDay ? 1 : 0);
    if (mo > 11) {
      mo = 0;
      y += 1;
    }
    const d = new Date(Date.UTC(y, mo, day));
    if (d.getUTCMonth() !== mo) continue;
    const real = WEEKDAYS[d.getUTCDay()] ?? '';
    if (fold(real) !== m[1]) {
      return `El ${day} de ${MONTHS[mo]} es ${real}, no ${m[1]}`;
    }
  }
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

/** El año de la fecha de nacimiento aparece en lo que escribió la familia ("2025", "3/6/25"). */
/**
 * La fecha de nacimiento tal como la escribió la familia, si está completa
 * ("15 de julio de 2026", "15/07/2026", "15-7-26"). La ÚLTIMA que aparezca
 * manda (los textos van del más reciente al más antiguo: se mira el primero).
 */
export function birthDateFromTexts(texts: string[]): string | null {
  const months = MONTHS.map(fold);
  for (const raw of texts) {
    const t = fold(raw);
    const words = new RegExp(
      `\\b(\\d{1,2})\\s*(?:de\\s+)?(${months.join('|')})\\s*(?:de\\s+|del\\s+)?(\\d{4}|\\d{2})\\b`,
      'g',
    );
    const found: string[] = [];
    for (const m of t.matchAll(words)) {
      const d = Number(m[1]);
      const mo = months.indexOf(m[2] ?? '') + 1;
      const y = yearOf(m[3] ?? '');
      if (d >= 1 && d <= 31 && mo >= 1 && y) found.push(key(y, mo, d));
    }
    for (const m of t.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/g)) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = yearOf(m[3] ?? '');
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y) found.push(key(y, mo, d));
    }
    if (found.length) return found[found.length - 1] ?? null;
  }
  return null;
}

function yearOf(s: string): number | null {
  if (s.length === 4) return Number(s);
  if (s.length === 2) return 2000 + Number(s);
  return null;
}
function key(y: number, mo: number, d: number): string {
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function birthYearSaid(birthDate: string, texts: string[]): boolean {
  const yyyy = birthDate.slice(0, 4);
  const yy = birthDate.slice(2, 4);
  const re = new RegExp(`\\b${yyyy}\\b|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*${yy}\\b`);
  return texts.some((t) => re.test(t));
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** "5 de noviembre" → 'YYYY-MM-DD' (el año que lo deja más cerca de hoy). */
function keyFromDayMonth(day: number, month: string, todayKey: string): string | null {
  const idx = MONTHS.findIndex((m) => fold(m) === fold(month));
  if (idx < 0 || !day) return null;
  let year = Number(todayKey.slice(0, 4));
  const key = `${year}-${String(idx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (key < addDaysKey(todayKey, -31)) year += 1;
  return `${year}${key.slice(4)}`;
}

/** "quiero cita", "tenéis hueco", "pedir hora"…: pide cita. */
export function asksForAppointment(text: string): boolean {
  // Quien escribe por una cita que YA tiene (anularla, cambiarla, confirmarla,
  // "la cita que tengo") no está pidiendo una nueva: el 10/11 a una madre que
  // quería anular le salió "¿es la primera vez que acudes?".
  if (
    /\b(anul\w*|cancel\w*|cambi\w*|mover|modific\w*|confirm\w*|retras\w*|no (podemos|puedo|vamos|voy|llegamos)|la cita (que tengo|de (hoy|mañana|manana|el)|del)|mi cita|nuestra cita|tengo (una )?cita|tenemos (una )?cita|ten[ií]amos cita)\b/i.test(
      text,
    )
  )
    return false;
  return /\b(cita|hueco|turno|hora para|pedir hora|reservar|agendar|consulta para)\b/i.test(text);
}

/**
 * Quita el saludo con que el modelo abre su respuesta cuando la app ya pone
 * la presentación ("Hola😊, soy …"). Antes se borraban hasta 20 caracteres
 * detrás de "Hola" y se comía el principio de la frase: "¿Te puedo ayudar?"
 * salía "Uedo ayudar?" y "Gracias por tu mensaje", "Acias por tu mensaje".
 * Ahora sólo cae la palabra del saludo, un nombre que vaya justo detrás y los
 * signos o emojis que los acompañan.
 */
export function dropLeadingGreeting(text: string): string {
  const greeting =
    /^\s*(?:hola|buen[oa]s(?:\s+(?:d[ií]as|tardes|noches))?)(?![\p{L}])[^\p{L}\p{N}\n¿¡]*/iu;
  let rest = text.replace(greeting, '');
  if (rest === text) return text.trim();
  // "Hola Laura 😊 ¿…": el nombre también sobra. Sólo un nombre propio suelto
  // seguido de coma, emoji o salto (no el principio de una frase).
  rest = rest.replace(
    /^[A-ZÁÉÍÓÚÑ][\p{Ll}]+(?=\s*(?:[,!.]|\p{Extended_Pictographic}|\n))[^\p{L}\p{N}\n¿¡]*/u,
    '',
  );
  rest = rest.trim();
  if (!rest) return text.trim();
  return rest.replace(
    /^([¿¡]?)(\p{Ll})/u,
    (_, sign: string, ch: string) => sign + ch.toUpperCase(),
  );
}

/** Ya dijo si es la primera vez o no (o da los datos de un niño conocido). */
export function answersFirstVisit(text: string): boolean {
  return /primera (vez|visita)|ya (he|hemos|fuimos|fui) (ido|venido|estado|acudido)|ya (vamos|venimos|somos pacientes)|otro (peque|hij[oa])|herman[oa]|nunca (hemos|he) (ido|venido)|es nuev|ya es paciente|ya (la |lo )?conoc|ya (ha|han) venido/i.test(
    text,
  );
}

/**
 * Nombres de los niños en ficha de este teléfono, sacados del texto de
 * get_patient_info ("Niños registrados:\n- Darío Pérez Gil (…)").
 */
export function registeredChildNames(knownContact: string | null | undefined): string[] {
  if (!knownContact || !/Niños registrados/.test(knownContact)) return [];
  const after = knownContact.split(/Niños registrados:?/i)[1] ?? '';
  return after
    .split('\n')
    .map((l) => l.replace(/^[-•\s]+/, '').trim())
    .filter((l) => l && !/^Pregunta /i.test(l))
    .map(
      (l) =>
        l
          .split(/[(·:,]/)[0]
          ?.trim()
          .split(/\s+/)[0] ?? '',
    )
    .filter((n) => n.length >= 2);
}

/** El mensaje nombra a un niño que ya está en ficha (entonces no es nuevo). */
export function mentionsRegisteredChild(
  text: string,
  knownContact: string | null | undefined,
): boolean {
  const f = fold(text);
  return registeredChildNames(knownContact).some((n) =>
    new RegExp(`\\b${fold(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(f),
  );
}

/**
 * La familia ya dijo en la conversación que es la primera vez (o que es otro
 * hermano) y no lo desdijo: check_availability va con first_visit=true aunque
 * el modelo no lo pase. El teléfono conocido por un hermano hacía que se
 * tratara al nuevo como paciente de siempre.
 */
export function conversationSaysFirstVisit(texts: string[]): boolean {
  const all = texts.map(fold).join('\n');
  const yes =
    /primera (vez|visita)|nunca (hemos|he) (ido|venido|estado)|es nuev|otro (peque|hij[oa])|herman[oa] (menor|pequen[oa])|con otro peque|es (su |la |el )?herman[oa]/.test(
      all,
    );
  const no =
    /no es la primera|ya (he|hemos|fuimos|fui) (ido|venido|estado|acudido)|ya es paciente|ya (ha|han) venido/.test(
      all,
    );
  return yes && !no;
}

/** La última línea con texto de lo que escribió la familia (una ráfaga llega unida por saltos). */
export function lastUserLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? text;
}

/** La familia pidió que le avisen si se libera algo antes. */
export function conversationWantsEarlier(texts: string[]): boolean {
  const all = texts.map(fold).join('\n');
  return /\b(avis\w*|aviseis|llam\w*)\b[^\n]{0,60}\b(antes|libera\w*|anula\w*|cancela\w*|hueco)\b|\b(si|cuando) (se )?(libera|queda|hay|sale|anula|cancela)\w*[^\n]{0,60}\b(avis\w*)|\blista de espera\b|\badelantar\w*\b/.test(
    all,
  );
}

/**
 * La familia escribió el nombre completo del niño tal cual (tres palabras o
 * más) y el modelo lo partió mal: "Lucas Andreev" + "Petrov" (10/11). Lo
 * que escribió la familia es el nombre completo; no se le vuelve a pedir el
 * "segundo apellido".
 */
export function fullNameWrittenByFamily(
  firstName: string,
  lastName: string,
  texts: string[],
): boolean {
  const words = `${firstName} ${lastName}`.trim().split(/\s+/).filter(Boolean).map(fold);
  if (words.length < 3) return false;
  const seq = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,]+');
  const re = new RegExp(`(^|[^\\p{L}])${seq}($|[^\\p{L}])`, 'u');
  return texts.some((t) => re.test(fold(t)));
}

/**
 * La familia dijo que el niño nuevo es hermano de uno que ya vino ("es el
 * hermano de Mario", "ya he acudido con otro peque", "el hermanito"). "Mi
 * hermana" (la tía) no cuenta: sólo hermano/a del niño.
 */
export function conversationSaysSibling(texts: string[]): boolean {
  const all = texts.map(fold).join('\n');
  return /\b(su|el|la|es (el|la)|un|una|otro|otra) herman(it)?[oa]s?\b|\bherman(it)?[oa]s? (mayor|menor|pequen[oa]|de)\b|otr[oa] (peque|hij[oa]|nin[oa])|con otro peque/.test(
    all,
  );
}

/**
 * "Quería informarme sobre las terapias / precios / cómo es la sesión": la
 * clínica no quiere la lista del catálogo con precios, sino su texto (web y
 * ofrecer cita). Pedir cita o un día concreto no es informarse.
 */
export function asksForGeneralInfo(text: string): boolean {
  const f = fold(text);
  if (asksForAppointment(text)) return false;
  // Pedir que le avisen, cancelar, cambiar, confirmar o preguntar por SU cita
  // no es informarse: eso lo atiende el modelo con sus herramientas.
  if (
    /\b(avis\w*|cancel\w*|anul\w*|liber\w*|adelant\w*|cambi\w*|confirm\w*|lista de espera|mi cita|la cita de)\b/.test(
      f,
    )
  )
    return false;
  return /\b(informa(r|rme|cion)|info|precios?|tarifas?|cuanto (cuesta|vale|es)|que (hac[eé]is|ofreceis|terapias)|en que consiste|como (es|son|funciona)n? (la|las|una) (sesion|sesiones|terapia|terapias)|las terapias|tratamientos que)\b/.test(
    f,
  );
}
