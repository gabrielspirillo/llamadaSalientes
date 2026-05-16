/**
 * Provisiona el agente Retell de OUTBOUND (campañas + callbacks reactivos).
 *
 * Uso:
 *   pnpm tsx apps/web/scripts/setup-outbound-agent.ts            # crea / actualiza el global (no tenant)
 *   pnpm tsx apps/web/scripts/setup-outbound-agent.ts <tenantId> # guarda el ID en agent_configs(role='outbound')
 *
 * Idempotente: si ya existe un agent_configs(role='outbound') con retell_agent_id,
 * solo refresca el prompt/LLM y reusa los IDs.
 *
 * Requisitos en .env.local:
 *   RETELL_API_KEY
 *   DIRECT_URL o DATABASE_URL  (solo si pasás tenantId)
 */
import path from 'node:path';
import { config } from 'dotenv';
import Retell from 'retell-sdk';

config({ path: path.resolve(__dirname, '../.env.local') });

const OUTBOUND_PROMPT = `Eres un asistente virtual de la clínica {{clinic_name}}. Llamás de forma SALIENTE a un paciente.

REGLAS GENERALES
- Hablá en español neutro, tono cálido y profesional, frases cortas.
- Identifícate al inicio: "Hola, soy el asistente virtual de {{clinic_name}}. ¿Hablo con {{patient_name}}?"
- Si la persona dice que NO es quien buscás o pide que no la llamen más, despedíte cortésmente y finalizá.
- Si saltó al buzón de voz, dejá un mensaje breve (máx 15s) pidiendo que se comuniquen con la clínica.
- Nunca prometas precios fijos ni descuentos que no estén en la información que recibís.
- Si te piden hablar con un humano o el tema escala, ofrecé transferir o tomar un mensaje.

CASO DE USO: {{use_case}}
- "payment" → Cobranza: el paciente tiene saldo pendiente de \${{monto_pendiente}} por {{tratamiento}}.
  Ofrecé opciones de pago, plan en cuotas o transferí a administración.
- "info" → Información general de la clínica (horarios, ubicación, servicios). Sé conciso.
- "reminder" → Recordatorio de cita el {{fecha_cita}} a las {{hora_cita}} con {{dentista}}.
  Confirmá asistencia, ofrecé reagendar si no puede.
- "reactivation" → El paciente no nos visita desde {{ultima_visita}}. Invitalo a agendar un control.
- "custom" → Seguí las instrucciones específicas en {{campaign_notes}}.

FECHA ACTUAL: {{current_date}}
ORIGEN: campaña "{{campaign_name}}", lead_source {{lead_source}}

CIERRE DE LLAMADA
- Antes de despedirte, preguntá: "¿Hay algo más en lo que pueda ayudarlo?".
- Cuando la persona no tenga más dudas o el objetivo del caso de uso esté cumplido,
  despedíte cortésmente e INMEDIATAMENTE invocá la tool end_call.
- Si saltó al buzón, dejá el mensaje breve y llamá a end_call.
- Si la persona pide explícitamente terminar la llamada, despedíte y llamá a end_call.

TRANSFERENCIA A HUMANO
- Si el paciente pide hablar con alguien de la clínica, o tu interacción no alcanza
  (urgencia médica, queja seria, decisión que requiere autorización humana),
  invocá la tool transfer_to_human para pasar la llamada al teléfono configurado.
- Antes de transferir, decí: "Te paso con una persona de la clínica, un momento por favor."
- IMPORTANTE: solo transferí si {{clinic_transfer_number}} tiene un número válido.
  Si está vacío, ofrecé tomar los datos del paciente para que la clínica lo contacte
  y NO llames a transfer_to_human.`;

const END_CALL_TOOL = {
  type: 'end_call' as const,
  name: 'end_call',
  description:
    'Finaliza y cuelga la llamada. Usar cuando el objetivo ya se cumplió y la persona no tiene más dudas, cuando ella pidió terminar, o tras dejar mensaje de buzón.',
};

const TRANSFER_TOOL = {
  type: 'transfer_call' as const,
  name: 'transfer_to_human',
  description:
    "Transferir la llamada a un humano de la clínica cuando: (a) el paciente pide hablar con una persona, (b) la situación excede tus capacidades, (c) hay queja seria o tema de pago complejo que requiere autorización, o (d) el paciente está alterado. Antes de transferir, decí: 'Te paso con una persona de la clínica, un momento por favor.' Solo invocar si {{clinic_transfer_number}} tiene un valor.",
  transfer_destination: { type: 'predefined' as const, number: '{{clinic_transfer_number}}' },
  transfer_option: { type: 'cold_transfer' as const, show_transferee_as_caller: true },
};

async function ensureLlm(client: Retell, existingLlmId: string | null): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: SDK params shape
  const payload: any = {
    model: 'gpt-4o-mini',
    general_prompt: OUTBOUND_PROMPT,
    begin_message:
      'Hola, soy el asistente virtual de {{clinic_name}}. ¿Hablo con {{patient_name}}?',
    general_tools: [END_CALL_TOOL, TRANSFER_TOOL],
  };

  if (existingLlmId) {
    console.log(`→ Actualizando LLM existente ${existingLlmId}`);
    // biome-ignore lint/suspicious/noExplicitAny: SDK
    await (client as any).llm.update(existingLlmId, payload);
    return existingLlmId;
  }

  console.log('→ Creando Retell LLM nuevo');
  // biome-ignore lint/suspicious/noExplicitAny: SDK
  const llm = await (client as any).llm.create(payload);
  console.log(`  ✓ LLM creado: ${llm.llm_id}`);
  return llm.llm_id as string;
}

async function ensureAgent(
  client: Retell,
  llmId: string,
  existingAgentId: string | null,
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: SDK params shape
  const payload: any = {
    response_engine: { type: 'retell-llm', llm_id: llmId },
    voice_id: '11labs-Adrian',
    agent_name: 'DentalVoice — Outbound',
    language: 'es-ES',
  };

  if (existingAgentId) {
    console.log(`→ Actualizando agente existente ${existingAgentId}`);
    // biome-ignore lint/suspicious/noExplicitAny: SDK
    await (client as any).agent.update(existingAgentId, payload);
    return existingAgentId;
  }

  console.log('→ Creando Retell agent nuevo');
  // biome-ignore lint/suspicious/noExplicitAny: SDK
  const agent = await (client as any).agent.create(payload);
  console.log(`  ✓ Agent creado: ${agent.agent_id}`);
  return agent.agent_id as string;
}

async function main() {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.error('❌ RETELL_API_KEY no está seteada en .env.local');
    process.exit(1);
  }

  const tenantId = process.argv[2] ?? null;
  const client = new Retell({ apiKey });

  // Si pasaron tenantId, intentar leer agent_config existente
  let existingLlmId: string | null = null;
  let existingAgentId: string | null = null;
  if (tenantId) {
    const { db } = await import('../lib/db/client');
    const { agentConfigs } = await import('../lib/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const [existing] = await db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.tenantId, tenantId), eq(agentConfigs.role, 'outbound')))
      .limit(1);
    existingLlmId = existing?.retellLlmId ?? null;
    existingAgentId = existing?.retellAgentId ?? null;
  }

  const llmId = await ensureLlm(client, existingLlmId);
  const agentId = await ensureAgent(client, llmId, existingAgentId);

  if (tenantId) {
    const { upsertAgentConfig } = await import('../lib/data/agent-config');
    await upsertAgentConfig({
      tenantId,
      role: 'outbound',
      retellAgentId: agentId,
      retellLlmId: llmId,
      currentPromptText: OUTBOUND_PROMPT,
      voiceId: '11labs-Adrian',
      published: true,
    });
    console.log(`\n✅ Listo. Guardado en agent_configs(tenant=${tenantId}, role=outbound)`);
  } else {
    console.log('\n✅ Listo. Pegá en tu .env.local:\n');
    console.log(`RETELL_OUTBOUND_DEFAULT_AGENT_ID=${agentId}\n`);
    console.log('(o pasá un tenantId como argumento para guardarlo en la DB)');
  }

  console.log('\nResumen:');
  console.log(`  llm_id   = ${llmId}`);
  console.log(`  agent_id = ${agentId}`);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
