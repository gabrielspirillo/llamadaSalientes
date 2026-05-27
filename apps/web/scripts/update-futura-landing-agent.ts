/**
 * Actualiza el LLM del agente Retell de la landing de FUTURA para que:
 *   1. Pida el correo electrónico del lead y lo cargue en GHL (tool set_lead_email).
 *   2. Tras agendar la demo, agradezca, pregunte si hay otra consulta, y corte (end_call).
 *
 * Uso:
 *   RETELL_API_KEY=key_... pnpm tsx apps/web/scripts/update-futura-landing-agent.ts
 *
 * Idempotente: re-ejecutar reemplaza el prompt y las tools del LLM.
 */
import Retell from 'retell-sdk';

const AGENT_ID = 'agent_b5ed188b95c62ad43b0c8e2d81';
const TOOLS_WEBHOOK_URL = 'https://app.futuradigital.es/api/retell/tools';

// ─── Prompt ──────────────────────────────────────────────────────────────────

const GENERAL_PROMPT = `Sos Sofía, asistente virtual de FUTURA, una empresa que desarrolla agentes de IA para clínicas.
Estás llamando a un lead que pidió una llamada de prueba desde la landing page de FUTURA.

OBJETIVO DE LA LLAMADA
Presentar brevemente qué hace FUTURA y agendar una demo de 30 minutos con el equipo.

REGLAS GENERALES
- Hablá en español neutro, tono cálido y profesional, frases cortas.
- Al inicio saludá: "Hola, soy Sofía de FUTURA. ¿Hablo con {{lead_name}}?"
- Si la persona dice que no es quien buscás, despedíte cortésmente y llamá a end_call.
- Si salta el buzón de voz, dejá un mensaje breve (~15 s) y llamá a end_call.
- Si te piden hablar con un humano, decí que el equipo se va a comunicar pronto y llamá a end_call.
- Nunca prometas precios fijos ni funcionalidades que no estén confirmadas.

FLUJO DE LA CONVERSACIÓN
1. Saludo + confirmación de identidad.
2. Breve pitch (máx 3 frases): "En FUTURA creamos agentes de IA que atienden llamadas y WhatsApp de clínicas 24/7. Muchas clínicas pierden hasta el 40% de las llamadas — nosotros resolvemos eso."
3. Invitá a agendar una demo de 30 minutos con el equipo: "¿Te gustaría que agendemos una demo de 30 minutos para que veas cómo funciona con tu clínica?"
4. Si acepta:
   a. Pedile el **correo electrónico**: "Perfecto, ¿me pasás tu correo electrónico así te mandamos la confirmación?"
   b. Guardá el correo llamando a la tool **set_lead_email** con el email y el teléfono del lead.
   c. Consultá disponibilidad con **check_availability** (treatment_name="Demo FUTURA").
   d. Ofrecé los horarios disponibles y confirmá con **book_appointment**.
   e. Una vez agendada: "¡Genial, queda agendada tu demo! Te va a llegar la confirmación al correo."
5. Si no acepta ahora, no insistas — ofrecé enviar info por correo (pedí el email igual con set_lead_email) y dejá la puerta abierta.

CIERRE DE LLAMADA
- Después de agendar (o si el lead no quiere agendar), preguntá: "¿Hay algo más en lo que pueda ayudarte?"
- Cuando no tenga más dudas, agradecé: "Muchas gracias por tu tiempo, {{lead_name}}. ¡Que tengas un excelente día!"
- Inmediatamente después llamá a la tool **end_call** para cortar la llamada.
- Si la persona pide terminar la llamada en cualquier momento, despedíte y llamá a end_call.

DATOS DEL LEAD
- Nombre: {{lead_name}}
- Teléfono (el que estás llamando): {{to_number}}
- Origen: {{demo_flow}}
- Fecha actual: {{current_date}}`;

// ─── Tools ───────────────────────────────────────────────────────────────────

const END_CALL_TOOL = {
  type: 'end_call' as const,
  name: 'end_call',
  description:
    'Finaliza y cuelga la llamada. Usar cuando: (a) se agendó la demo y no hay más consultas, (b) el lead pide terminar, (c) dejaste mensaje de buzón, (d) no es la persona correcta.',
};

const SET_LEAD_EMAIL_TOOL = {
  type: 'custom' as const,
  name: 'set_lead_email',
  description:
    'Guarda el correo electrónico del lead en el CRM. Llamá a esta tool apenas el lead te dé su email.',
  url: TOOLS_WEBHOOK_URL,
  speak_during_execution: true,
  speak_after_execution: false,
  parameters: {
    type: 'object' as const,
    properties: {
      email: {
        type: 'string' as const,
        description: 'Correo electrónico del lead.',
      },
      phone: {
        type: 'string' as const,
        description: 'Teléfono del lead en formato E.164 (ej: +34611223344).',
      },
    },
    required: ['email', 'phone'],
  },
};

const CHECK_AVAILABILITY_TOOL = {
  type: 'custom' as const,
  name: 'check_availability',
  description:
    'Consulta los horarios disponibles para agendar una demo. Devuelve los próximos slots libres.',
  url: TOOLS_WEBHOOK_URL,
  speak_during_execution: true,
  speak_after_execution: false,
  parameters: {
    type: 'object' as const,
    properties: {
      treatment_name: {
        type: 'string' as const,
        description: 'Nombre del servicio a agendar (usar "Demo FUTURA").',
      },
      preferred_date: {
        type: 'string' as const,
        description: 'Fecha preferida en formato YYYY-MM-DD.',
      },
    },
    required: ['treatment_name', 'preferred_date'],
  },
};

const REGISTER_PATIENT_TOOL = {
  type: 'custom' as const,
  name: 'register_patient',
  description:
    'Crea un nuevo contacto en el CRM si no existe. Devuelve el contact_id para usarlo en book_appointment.',
  url: TOOLS_WEBHOOK_URL,
  speak_during_execution: true,
  speak_after_execution: false,
  parameters: {
    type: 'object' as const,
    properties: {
      first_name: {
        type: 'string' as const,
        description: 'Nombre del lead.',
      },
      last_name: {
        type: 'string' as const,
        description: 'Apellido del lead.',
      },
      phone: {
        type: 'string' as const,
        description: 'Teléfono en formato E.164.',
      },
      email: {
        type: 'string' as const,
        description: 'Correo electrónico del lead.',
      },
    },
    required: ['first_name', 'phone'],
  },
};

const GET_PATIENT_INFO_TOOL = {
  type: 'custom' as const,
  name: 'get_patient_info',
  description:
    'Busca un contacto en el CRM por teléfono. Devuelve contact_id + nombre si existe.',
  url: TOOLS_WEBHOOK_URL,
  speak_during_execution: true,
  speak_after_execution: false,
  parameters: {
    type: 'object' as const,
    properties: {
      phone: {
        type: 'string' as const,
        description: 'Teléfono a buscar en formato E.164.',
      },
    },
    required: ['phone'],
  },
};

const BOOK_APPOINTMENT_TOOL = {
  type: 'custom' as const,
  name: 'book_appointment',
  description:
    'Agenda una cita/demo. Necesita contact_id (de get_patient_info o register_patient), start_time y treatment_name.',
  url: TOOLS_WEBHOOK_URL,
  speak_during_execution: true,
  speak_after_execution: false,
  parameters: {
    type: 'object' as const,
    properties: {
      contact_id: {
        type: 'string' as const,
        description: 'ID del contacto en GHL.',
      },
      phone: {
        type: 'string' as const,
        description: 'Teléfono del lead (fallback si no hay contact_id).',
      },
      start_time: {
        type: 'string' as const,
        description: 'Fecha y hora de inicio en formato ISO 8601 (ej: 2026-05-28T10:00:00).',
      },
      treatment_name: {
        type: 'string' as const,
        description: 'Nombre del servicio (usar "Demo FUTURA").',
      },
    },
    required: ['start_time', 'treatment_name'],
  },
};

const ALL_TOOLS = [
  END_CALL_TOOL,
  SET_LEAD_EMAIL_TOOL,
  CHECK_AVAILABILITY_TOOL,
  GET_PATIENT_INFO_TOOL,
  REGISTER_PATIENT_TOOL,
  BOOK_APPOINTMENT_TOOL,
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('❌ RETELL_API_KEY no está seteada. Ejecutá con:\n  RETELL_API_KEY=key_... pnpm tsx apps/web/scripts/update-futura-landing-agent.ts');
    process.exit(1);
  }

  const client = new Retell({ apiKey });

  // 1. Leer el agente para obtener el llm_id
  console.log(`→ Leyendo agente ${AGENT_ID}...`);
  // biome-ignore lint/suspicious/noExplicitAny: SDK types incomplete
  const agent = await (client as any).agent.retrieve(AGENT_ID);
  const llmId: string | undefined = agent.response_engine?.llm_id;

  if (!llmId) {
    console.error('❌ No pude obtener llm_id del agente. response_engine:', JSON.stringify(agent.response_engine));
    process.exit(1);
  }
  console.log(`  ✓ llm_id = ${llmId}`);

  // 2. Leer el LLM actual (para logging)
  console.log(`→ Leyendo LLM ${llmId}...`);
  // biome-ignore lint/suspicious/noExplicitAny: SDK types incomplete
  const llm = await (client as any).llm.retrieve(llmId);
  console.log('  Prompt actual (primeros 200 chars):', (llm.general_prompt ?? '').slice(0, 200), '...');
  console.log('  Tools actuales:', (llm.general_tools ?? []).map((t: { name?: string }) => t.name).join(', ') || '(ninguna)');

  // 3. Actualizar el LLM
  console.log(`→ Actualizando LLM ${llmId}...`);
  // biome-ignore lint/suspicious/noExplicitAny: SDK types incomplete
  await (client as any).llm.update(llmId, {
    general_prompt: GENERAL_PROMPT,
    general_tools: ALL_TOOLS,
  });
  console.log('  ✓ Prompt actualizado');
  console.log('  ✓ Tools:', ALL_TOOLS.map((t) => t.name).join(', '));

  console.log('\n✅ Listo. El agente ahora:');
  console.log('  • Pide el correo y lo guarda en GHL (set_lead_email)');
  console.log('  • Agenda la demo (check_availability + book_appointment)');
  console.log('  • Agradece, pregunta si hay más consultas, y corta (end_call)');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
