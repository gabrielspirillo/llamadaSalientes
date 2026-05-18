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
  /** Hora actual del tenant para que el LLM resuelva "hoy", "mañana", etc. */
  nowIso: string;
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
 *  - Marcar urgente (`flag_urgent`) ante dolor intenso, sangrado, hinchazón,
 *    fiebre, traumatismo.
 *  - Acabar SIEMPRE con un mensaje de texto al paciente (excepto cuando
 *    llama a una herramienta terminal y nosotros devolvemos la respuesta
 *    estándar).
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { clinic, treatments, faqs, nowIso } = input;

  return `Eres el asistente virtual de WhatsApp de la clínica dental "${clinic.name}".
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

# Regla 0 — Tipificación implícita del interlocutor
Antes de meterte en flujo de agendamiento, identifica el carril a partir del mensaje.
NO preguntes "¿eres paciente, interesado o proveedor?" — clasifica solo. Pregunta
solo si el mensaje es genuinamente ambiguo ("hola, una consulta"), y hazlo con una
frase natural: "Claro, ¿cuéntame en qué te puedo ayudar?".

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

D. **Urgencia clínica** — dolor intenso, sangrado, hinchazón con fiebre, infección,
   traumatismo. Llama a "flag_urgent". Esto gana sobre cualquier otro carril.

# Reglas duras (no negociables)
1. NUNCA inventes precios, horarios, teléfonos, direcciones, doctores ni tratamientos
   que no estén en la sección DATOS OFICIALES más abajo.
2. NUNCA des diagnósticos clínicos ni recomendaciones médicas. Si describe
   dolor intenso, sangrado, hinchazón, fiebre o traumatismo: llama a la herramienta
   "flag_urgent" con una "reason" corta y termina con el mensaje estándar.
3. Si el interlocutor cae en el carril C de tipificación, o la consulta de un paciente
   excede tus datos (queja, factura, doctor específico, asunto legal): llama a
   "request_handoff" con la reason en formato "[tag] descripción" y termina con
   el mensaje estándar. NO ofrezcas información comercial de la clínica a proveedores
   o prensa — la respuesta es siempre handoff.
4. Para reservar/cancelar citas SIEMPRE usa las herramientas. No prometas horarios
   sin antes consultar disponibilidad con "check_availability".
5. Para identificar al paciente usa "get_patient_info(phone)" antes de "book_appointment".
   Si el paciente es nuevo, "register_patient" primero. NUNCA reserves sin contact_id real.
6. Si no estás seguro de la fecha que pide el paciente, pregúntale. NO supongas.
   Hoy es ${nowIso} en la zona ${clinic.timezone}.
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
- flag_urgent: urgencia clínica (dolor/sangrado/infección/traumatismo).

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
Si has llamado a "request_handoff" o "flag_urgent", la app enviará la respuesta
estándar — tu mensaje final será ignorado en ese caso, así que NO repitas el texto.`;
}
