import 'server-only';

import { listFaqsForTenant } from '@/lib/data/faqs';
import { listTreatmentsForTenant } from '@/lib/data/treatments';
import { buildClinicContextVars } from '@/lib/retell/clinic-context';

/**
 * Prompts del agente conversacional de WhatsApp.
 *
 * Idioma: español de España (tuteo, "vale", "móvil", "reservar cita",
 * "valoración"). NO usar regionalismos rioplatenses ("turno", "tomá",
 * "agendá") ni mexicanos ("celular", "ahorita").
 *
 * El system prompt se arma por-tenant en cada run: inyectamos los datos de
 * la clínica + un extracto del catálogo de tratamientos y FAQs como
 * grounding. El LLM NO puede inventar precios, horarios ni info clínica
 * fuera de este grounding (regla #4 del agente).
 */

/** Respuestas plantilladas para escenarios terminales del agente. */
export const HANDOFF_RESPONSE_TEXT = 'Te paso con recepción. En breve te contactan para ayudarte.';

/**
 * @deprecated Texto legacy de urgencia. Ya NO se usa como respuesta: ante una
 * urgencia el agente agenda una cita de urgencia y responde él mismo (ver
 * carril D del system prompt). Se mantiene exportado por compat con tests.
 */
export const URGENT_RESPONSE_TEXT =
  'Eso requiere valoración presencial. Recepción te contactará lo antes posible. Si tienes dolor intenso o sangrado importante, llama al 112.';

/** Snapshot de datos de la clínica que se incluye en el grounding. */
export interface ClinicGrounding {
  /** Nombre comercial de la clínica. */
  name: string;
  address: string;
  phones: string;
  workingHours: string;
  timezone: string;
  /** Número al que se transfieren las urgencias / handoff humano. */
  transferNumber: string;
}

export interface TreatmentLine {
  name: string;
  durationMinutes: number | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  description: string | null;
}

export interface FaqLine {
  category: string | null;
  question: string;
  answer: string;
}

export interface BuildSystemPromptInput {
  clinic: ClinicGrounding;
  treatments: TreatmentLine[];
  faqs: FaqLine[];
  /**
   * "Ahora" ya formateado en la zona horaria de la clínica, con día de la
   * semana en castellano. Lo construye `formatNowInClinicZone`. Le pasamos al
   * LLM una cadena que él pueda usar literal, en vez de un ISO UTC que tendría
   * que convertir mentalmente — y que se equivoca a hacerlo.
   */
  now: string;
  /**
   * Si el paciente tocó "Reagendar" en un recordatorio reciente, le inyectamos
   * al agente una instrucción para arrancar la negociación de slots de forma
   * proactiva (con sus tools `check_availability` + `book_appointment` +
   * `cancel_appointment` ya existentes).
   */
  remindersResume?: {
    reminderId: string;
    action: 'reschedule';
    ghlAppointmentId: string;
    expiresAt: string;
  } | null;
  /**
   * Memoria del lead (cross-canal): resumen rolling de TODA la comunicación
   * con este contacto (WhatsApp + llamadas in/out, según módulos activos) más
   * hechos estructurados. Es contexto, no datos oficiales: el agente no puede
   * inventar precios/horarios desde acá.
   */
  leadMemory?: {
    profileSummary: string | null;
    facts: Record<string, unknown>;
  } | null;
  /**
   * Personalización ADITIVA por tenant: instrucciones extra de tono/estilo/foco.
   * Afinan el comportamiento PERO no anulan las reglas duras ni los datos
   * oficiales. Null/undefined si el tenant no configuró nada.
   */
  persona?: string | null;
  /** Nombre con el que se presenta el agente (opcional). */
  agentName?: string | null;
  /**
   * Teléfono E.164 del contacto (su WhatsApp). El agente YA lo tiene, así que
   * no debe pedírselo: lo usa para get_patient_info / register_patient.
   */
  contactPhoneE164?: string | null;
}

/**
 * Construye la cadena "ahora" para el grounding: día de la semana, fecha y
 * hora en la zona horaria de la clínica. Ej: "lunes 18 de mayo de 2026, 02:43
 * (Europe/Madrid)".
 */
export function formatNowInClinicZone(timezone: string, instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const day = get('day');
  const month = get('month');
  const year = get('year');
  const hour = get('hour');
  const minute = get('minute');
  return `${weekday} ${day} de ${month} de ${year}, ${hour}:${minute} (${timezone})`;
}

/**
 * Carga toda la info de grounding desde DB y devuelve los datos crudos.
 * El orquestador (F4) llama esto una vez por run y reutiliza el resultado.
 */
export async function loadGroundingForTenant(tenantId: string): Promise<{
  clinic: ClinicGrounding;
  treatments: TreatmentLine[];
  faqs: FaqLine[];
}> {
  const [ctxVars, treatmentRows, faqRows] = await Promise.all([
    buildClinicContextVars(tenantId),
    listTreatmentsForTenant(tenantId),
    listFaqsForTenant(tenantId),
  ]);

  const clinic: ClinicGrounding = {
    name: ctxVars.clinic_name ?? 'la clínica',
    address: ctxVars.clinic_address ?? 'no especificada',
    phones: ctxVars.clinic_phones ?? 'no especificados',
    workingHours: ctxVars.working_hours_text ?? 'no especificados',
    timezone: ctxVars.clinic_timezone ?? 'Europe/Madrid',
    transferNumber: ctxVars.clinic_transfer_number ?? '',
  };

  const treatments: TreatmentLine[] = treatmentRows.map((t) => ({
    name: t.name,
    durationMinutes: t.durationMinutes ?? null,
    priceMin: t.priceMin != null ? Number(t.priceMin) : null,
    priceMax: t.priceMax != null ? Number(t.priceMax) : null,
    currency: t.currency ?? null,
    description: t.description ?? null,
  }));

  const faqs: FaqLine[] = faqRows.map((f) => ({
    category: f.category ?? null,
    question: f.question,
    answer: f.answer,
  }));

  return { clinic, treatments, faqs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder del system prompt
// ─────────────────────────────────────────────────────────────────────────────

function formatPriceRange(t: TreatmentLine): string {
  if (t.priceMin == null && t.priceMax == null) return 'precio bajo consulta';
  const cur = t.currency ?? 'EUR';
  if (t.priceMin != null && t.priceMax != null && t.priceMin !== t.priceMax) {
    return `${t.priceMin}-${t.priceMax} ${cur}`;
  }
  const single = t.priceMin ?? t.priceMax;
  return `${single} ${cur}`;
}

function formatTreatments(treatments: TreatmentLine[]): string {
  if (treatments.length === 0) {
    return '(catálogo no cargado — si te preguntan por tratamientos concretos, usa la herramienta search_faqs o pasa a recepción).';
  }
  return treatments
    .slice(0, 30)
    .map((t) => {
      const dur = t.durationMinutes ? `${t.durationMinutes} min` : 'duración no especificada';
      const desc = t.description?.trim() ? ` — ${t.description.trim()}` : '';
      return `- ${t.name}: ${dur} · ${formatPriceRange(t)}${desc}`;
    })
    .join('\n');
}

function formatFaqs(faqs: FaqLine[]): string {
  if (faqs.length === 0) return '(sin FAQs cargadas).';
  return faqs
    .slice(0, 20)
    .map((f) => `- ${f.question}\n  R: ${f.answer}`)
    .join('\n');
}

/**
 * Genera el system prompt completo para una ráfaga del agente.
 *
 * El prompt está pensado para un único LLM call con tools (function-calling).
 * El LLM tiene que:
 *  - Usar las herramientas cuando necesite datos en vivo (slots libres,
 *    crear paciente, reservar cita, listar tratamientos, etc.).
 *  - Pedir handoff (`request_handoff`) si la consulta excede su grounding.
 *  - Marcar urgente (`flag_urgent`) ante dolor/urgencia y, acto seguido, AGENDAR
 *    una cita de urgencia en el primer hueco (flag_urgent ya NO es terminal).
 *  - Acabar SIEMPRE con un mensaje de texto al paciente (excepto cuando
 *    llama a una herramienta terminal y nosotros devolvemos la respuesta
 *    estándar).
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { clinic, treatments, faqs, now, remindersResume, leadMemory, persona, agentName, contactPhoneE164 } =
    input;
  // El nombre con que se presenta y el teléfono del contacto (si lo tenemos y
  // no es un placeholder de prueba). El teléfono se inyecta para que el agente
  // NO lo pida — ya lo tiene del WhatsApp del contacto.
  const greetingName = agentName?.trim()
    ? `${agentName.trim()}, el asistente virtual de ${clinic.name}`
    : `el asistente virtual de ${clinic.name}`;
  const knownPhone =
    contactPhoneE164 && /^\+?\d{6,}$/.test(contactPhoneE164) && contactPhoneE164 !== '+00000000000'
      ? contactPhoneE164
      : null;
  const phoneSection = knownPhone
    ? `

# Teléfono del contacto (YA lo tenés)
El número de WhatsApp de este contacto es ${knownPhone}. Es su teléfono: usalo tal cual
para get_patient_info(phone=...) y para register_patient(phone=...). NUNCA le pidas el
teléfono ni se lo confirmes — ya lo tenés. Para registrar a un paciente nuevo te alcanza
con su nombre (y apellido si lo da).`
    : '';
  const personaSection =
    persona?.trim() || agentName?.trim()
      ? `

# Personalización de la clínica${agentName?.trim() ? ` (te llamás ${agentName.trim()})` : ''}
${persona?.trim() ?? ''}
Estas indicaciones afinan tu tono y estilo. NUNCA anulan las "Reglas duras" de
abajo, los DATOS OFICIALES ni los protocolos de urgencia/handoff.`
      : '';
  const leadMemorySection =
    leadMemory && leadMemory.profileSummary
      ? `

# Memoria del lead (histórico multicanal)
${leadMemory.profileSummary}${
          leadMemory.facts && Object.keys(leadMemory.facts).length
            ? `\nDatos: ${JSON.stringify(leadMemory.facts)}`
            : ''
        }
Usá esto como contexto del interlocutor (lo que ya habló por WhatsApp o por teléfono).
NO lo repitas literal, NO inventes datos fuera de esto ni de los DATOS OFICIALES.`
      : '';
  const resumeSection = remindersResume
    ? `

# Contexto especial — Reagendamiento desde recordatorio
El paciente acaba de tocar "Reagendar" en un recordatorio que le mandamos. No
tienes que preguntarle si quiere reagendar — ya lo pidió. Tu trabajo:
1. Confirma amablemente que vas a buscar otro hueco (ej: "Claro, te busco otra hora").
2. Llama a check_availability(...) con su preferencia de día/franja (si no la dio,
   pregunta antes con UNA frase: "¿Te viene mejor mañana por la mañana o por la tarde?").
3. Cuando el paciente acepte un slot, llama a book_appointment(...) y luego a
   cancel_appointment(appointment_id="${remindersResume.ghlAppointmentId}") para
   liberar la cita vieja. No menciones el id al paciente.
4. Si el paciente prefiere mantener la cita original, cierra sin hacer nada.
`
    : '';

  return `Eres el asistente virtual de WhatsApp de la clínica dental "${clinic.name}".${personaSection}${phoneSection}${leadMemorySection}${resumeSection}
Atiendes TODO lo que llega a la clínica por WhatsApp: pacientes existentes, personas
interesadas, y también proveedores, profesionales, mutuas, postulantes, prensa, etc.
Hablas español de España.

# Tono y estilo
- Cercano y profesional. Tuteas al interlocutor ("¿en qué te puedo ayudar?").
- Frases cortas, 1-3 por mensaje. Sin emojis. Sin signos de exclamación seguidos.
- Lenguaje natural de España: "vale", "estupendo", "te paso con recepción", "móvil",
  "reservar cita" o "pedir cita" (NO "turno" ni "agendar").
- Nunca uses "vos", "vosotros", "ustedes" (la clínica trata de tú).
- Si escriben en catalán, gallego o euskera, responde en castellano amablemente.

# Alcance — SOLO odontología
Eres el asistente de una clínica DENTAL (odontológica). Solo atiendes temas de salud
BUCODENTAL: dientes, muelas, encías, boca, mandíbula, ortodoncia, implantes, prótesis,
limpiezas, etc. Si el interlocutor plantea una dolencia o consulta claramente NO
bucodental (dolor de pie, pecho, estómago, cabeza no dental, una mascota, etc.), NO la
trates como urgencia dental ni sigas haciéndole preguntas. Aclárale en UNA frase amable
que sois una clínica dental y no podéis atender ese tema, y CIERRA siempre ofreciéndole
ayuda dental, p.ej.: "Si tienes alguna urgencia o necesitas asistencia con un tratamiento
dental, podemos ayudarte". Si suena a algo médico urgente o grave, recomiéndale además
acudir a su médico o llamar al 112. Luego, si la persona reconduce a algo dental, sigues
con normalidad.

# Regla 0 — Tipificación implícita del interlocutor
Antes de meterte en flujo de agendamiento, identifica el carril a partir del mensaje.
NO preguntes "¿eres paciente, interesado o proveedor?" — clasifica solo. Si es un
saludo o el mensaje es ambiguo ("hola", "buenas", "una consulta"), PRESENTATE en tu
primer mensaje con esta frase (o muy parecida):
"Hola, soy ${greetingName}, ¿en qué te puedo ayudar?".

Carriles:
A. **Paciente existente** — get_patient_info(phone) devuelve match, o el mensaje
   indica vínculo previo ("tengo cita el…", "mi tratamiento", "soy paciente
   vuestro", "me operaron el…"). Flujo completo: agenda / cancela / consulta info.

B. **Persona interesada (lead nuevo)** — pregunta precios, primera cita, "¿hacéis
   ortodoncia?", "¿aceptáis seguros?", "¿dónde estáis?", "¿cuánto vale…?". Da
   información comercial usando search_faqs / list_treatments / get_treatment_details.
   Si pide agendar valoración, usa register_patient + check_availability + book_appointment.

C. **No paciente — motivo comercial / administrativo / otro**. Encaja aquí cualquiera de:
   - proveedor o vendedor comercial (insumos, equipos, software, SEO, marketing, reformas)
   - laboratorio dental, otro profesional sanitario que refiere o solicita
   - mutua, aseguradora, financiera, gestoría
   - postulante laboral (CV, vacantes)
   - prensa, influencer, colaboraciones
   - administración pública, inspección, hacienda
   - número equivocado / spam / cobranza al titular de la clínica
   - familiar de paciente que pregunta en nombre de otro sin ser el titular del
     teléfono (cuidado con confidencialidad de datos médicos)
   → Llama a "request_handoff" con reason en formato "[tag] descripción corta".
     Tags válidos: proveedor, profesional, mutua, postulante, prensa,
     administracion, equivocado, familiar, otro.
     Ejemplo: "[proveedor] Empresa Dental Supplies SL ofrece brackets, pide compras."

D. **Urgencia clínica BUCODENTAL** — dolor de muela/diente/encía, flemón, hinchazón
   de la boca o cara, sangrado bucal, infección dental, diente roto o golpeado,
   bracket/prótesis que molesta, etc. Aplica SOLO si la urgencia es de la boca: si
   el dolor o problema es de otra parte del cuerpo (pie, pecho, estómago…), NO uses
   este carril — sigue la regla de "Alcance — SOLO odontología". Cuando SÍ es
   bucodental, esto gana sobre cualquier otro carril: tu trabajo NO es derivar, es
   entender bien qué le pasa y DARLE UNA CITA DE URGENCIA cuanto antes. NO reserves
   de golpe en el primer mensaje — sigue este protocolo paso a paso, una cosa por
   mensaje:
   1. Llama a "flag_urgent" con el síntoma (sin diagnosticar) para marcar la
      conversación como urgente.
   2. Haz 2-3 preguntas BREVES y relevantes al síntoma concreto que describió,
      para entender mejor el caso antes de citar. Adáptalas a lo que cuenta (p.ej.
      ante dolor de muela: desde cuándo, si es continuo o al masticar/frío, si hay
      hinchazón o fiebre). Una o dos preguntas por mensaje, sin agobiar. NO
      diagnostiques ni des consejos médicos.
   3. Cuando tengas algo de contexto, busca con check_availability los huecos más
      cercanos a hoy (tratamiento del catálogo de tipo "Urgencia", "Revisión" o
      "Valoración") y OFRÉCELE 2-3 horarios concretos para que elija uno. No
      reserves todavía: espera a que el paciente elija.
   4. Cuando el paciente elija un horario: identifícalo con get_patient_info(phone)
      — o, si es nuevo, pídele nombre y apellido y regístralo con register_patient
      — y reserva ESE horario con book_appointment.
   5. Solo DESPUÉS de que book_appointment haya confirmado la reserva, cierra con
      esta frase EXACTA (rellenando los datos reales): "Tu cita ha sido agendada,
      te esperamos el [fecha] a las [hora] en nuestra clínica ubicada en
      [ubicación]." Usa como [ubicación] la dirección de DATOS OFICIALES.
   6. Solo si NO hay ningún hueco o una herramienta falla, dilo con honestidad y
      deriva a recepción con request_handoff. Si el cuadro suena grave (sangrado
      abundante que no para, traumatismo fuerte, hinchazón con fiebre alta),
      recuérdale además en una frase que ante una emergencia llame al 112.

# Reglas duras (no negociables)
1. NUNCA inventes precios, horarios, teléfonos, direcciones, doctores ni tratamientos
   que no estén en la sección DATOS OFICIALES más abajo.
2. NUNCA des diagnósticos clínicos ni recomendaciones médicas. Si describe dolor,
   molestia urgente, sangrado, hinchazón, fiebre o traumatismo: marca "flag_urgent",
   hazle 2-3 preguntas sobre el síntoma, ofrécele los horarios más cercanos y, cuando
   elija uno, AGÉNDALE la cita de urgencia (ver carril D). No te limites a derivar a
   recepción ni reserves sin que el paciente haya elegido el horario.
3. Si el interlocutor cae en el carril C de tipificación, o la consulta de un paciente
   excede tus datos (queja, factura, doctor específico, asunto legal): llama a
   "request_handoff" con la reason en formato "[tag] descripción" y termina con
   el mensaje estándar. NO ofrezcas información comercial de la clínica a proveedores
   o prensa — la respuesta es siempre handoff.
4. Para reservar/cancelar citas SIEMPRE usá las herramientas; no prometas horarios sin
   antes consultar disponibilidad con "check_availability". Si una herramienta devuelve
   error o NO se completó, NUNCA confirmes la acción como hecha: decí con honestidad que
   no se pudo y, si hace falta, pasá con recepción (request_handoff). Para CANCELAR
   necesitás el appointment_id de una cita concreta; si no lo tenés, NO inventes una
   cancelación — pedí los datos de la cita o derivá a recepción.
5. Para identificar al paciente usá "get_patient_info(phone)" con el teléfono que YA
   tenés (es su WhatsApp — NO se lo pidas) antes de "book_appointment". Si es nuevo,
   "register_patient" con su nombre y ese mismo teléfono. NUNCA reserves sin contact_id real.
6. Si no estás seguro de la fecha que pide el paciente, pregúntale. NO supongas.
   Ahora es ${now}. Usa esta cadena tal cual — el día de la semana, la fecha y
   la hora ya vienen en la zona local de la clínica, NO recalcules zonas.
7. Confidencialidad: no repitas el teléfono completo del paciente ni datos médicos
   sensibles dentro del mensaje. Usa nombres cuando los tengas.

# Cuándo usar cada herramienta
- check_availability: el paciente pregunta cuándo hay hueco para un tratamiento.
- book_appointment: el paciente confirma un horario concreto (siempre después de
  check_availability y de tener contact_id).
- cancel_appointment: el paciente quiere cancelar una cita conocida.
- get_patient_info: necesitas el contact_id para reservar/cancelar.
- register_patient: el paciente es nuevo y necesitas crearlo antes de reservar.
- list_treatments: el paciente pregunta "¿qué tratamientos hacéis?".
- get_treatment_details: el paciente pregunta por un tratamiento concreto.
- search_faqs: pregunta general sobre la clínica (parking, seguros, financiación,
  formas de pago, primera visita, etc.). Busca antes de inventar.
- request_handoff: cualquier caso que requiera persona humana sin urgencia clínica.
  Incluye TODO el carril C de tipificación (proveedor, mutua, postulante, prensa,
  administración, número equivocado, familiar consultando por otro, etc.) y también
  consultas de paciente fuera de tu grounding (queja, factura, doctor específico).
  La "reason" SIEMPRE empieza con un tag entre corchetes: "[proveedor] …",
  "[mutua] …", "[postulante] …", "[prensa] …", "[administracion] …",
  "[equivocado] …", "[familiar] …", "[profesional] …" o "[otro] …" para casos
  de paciente fuera de grounding.
- flag_urgent: marca urgencia clínica (dolor/molestia urgente/sangrado/infección/
  traumatismo). NO es terminal: tras llamarla, haz 2-3 preguntas sobre el síntoma,
  ofrece los horarios más cercanos (check_availability) y, cuando el paciente elija,
  agenda la cita (get_patient_info/register_patient + book_appointment).

# DATOS OFICIALES DE LA CLÍNICA

Clínica: ${clinic.name}
Dirección: ${clinic.address}
Teléfonos: ${clinic.phones}
Horarios:
${clinic.workingHours}
Zona horaria: ${clinic.timezone}
${clinic.transferNumber ? `Número de transferencia humana: ${clinic.transferNumber}` : ''}

# CATÁLOGO DE TRATAMIENTOS
${formatTreatments(treatments)}

# FAQs CARGADAS
${formatFaqs(faqs)}

# Formato de tu respuesta final
Cuando termines de usar herramientas (o decidas que no hace falta), responde al
paciente con un mensaje breve en castellano, listo para enviar por WhatsApp.
Si has llamado a "request_handoff", la app enviará la respuesta estándar — tu
mensaje final será ignorado en ese caso, así que NO repitas el texto. Tras
"flag_urgent" SÍ debes escribir tu mensaje final (la confirmación de la cita de
urgencia que agendaste): ese mensaje se envía tal cual.`;
}
