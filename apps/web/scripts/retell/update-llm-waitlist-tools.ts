/* eslint-disable no-console */
// Sincroniza el LLM outbound DentalVoice — Outbound en Retell agregando las
// tools necesarias para waitlist y appointment management.
//
// Tools agregadas (idempotente: si ya existen, no las duplica):
//   - check_availability
//   - book_appointment
//   - cancel_appointment
//   - get_patient_info
//   - accept_waitlist_offer
//   - decline_waitlist_offer
//
// Uso:
//   RETELL_API_KEY=key_... LLM_ID=llm_... tsx scripts/retell/update-llm-waitlist-tools.ts
//   (defaults a llm_daa9e8aee1f24a30f0bfff908ed9 si no se pasa LLM_ID)

import 'dotenv/config';

const RETELL_API = 'https://api.retellai.com';
const TOOLS_URL = 'https://app.futuradigital.es/api/retell/tools';

type RetellTool = {
  name: string;
  type: string;
  description?: string;
  url?: string;
  method?: 'POST' | 'GET';
  parameters?: { type: string; properties: Record<string, unknown>; required?: string[] };
  speak_during_execution?: boolean;
  speak_after_execution?: boolean;
  timeout_ms?: number;
};

const NEW_TOOLS: RetellTool[] = [
  {
    name: 'check_availability',
    type: 'custom',
    description: 'Consulta los horarios disponibles para un tratamiento en una fecha dada.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        treatment_name: { type: 'string' },
        preferred_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['treatment_name', 'preferred_date'],
    },
    speak_during_execution: true,
    speak_after_execution: false,
    timeout_ms: 120000,
  },
  {
    name: 'book_appointment',
    type: 'custom',
    description: 'Agenda una cita en GHL para el contacto en el slot indicado.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        calendar_id: { type: 'string' },
        start_time: { type: 'string', description: 'ISO 8601' },
        treatment_name: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['start_time', 'treatment_name'],
    },
    speak_during_execution: true,
    speak_after_execution: false,
    timeout_ms: 120000,
  },
  {
    name: 'cancel_appointment',
    type: 'custom',
    description: 'Cancela una cita existente en GHL por ID.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: { appointment_id: { type: 'string' } },
      required: ['appointment_id'],
    },
    speak_during_execution: true,
    speak_after_execution: false,
    timeout_ms: 120000,
  },
  {
    name: 'get_patient_info',
    type: 'custom',
    description: 'Busca un contacto en el CRM por teléfono.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: { phone: { type: 'string' } },
      required: ['phone'],
    },
    speak_during_execution: true,
    speak_after_execution: false,
    timeout_ms: 120000,
  },
  {
    name: 'accept_waitlist_offer',
    type: 'custom',
    description:
      'El paciente acepta el slot adelantado que le estás ofreciendo. Cancela su cita vieja y agenda la nueva.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: { offer_id: { type: 'string' } },
      required: ['offer_id'],
    },
    speak_during_execution: true,
    speak_after_execution: true,
    timeout_ms: 120000,
  },
  {
    name: 'decline_waitlist_offer',
    type: 'custom',
    description: 'El paciente rechaza el slot adelantado. Su cita original queda intacta.',
    url: TOOLS_URL,
    method: 'POST',
    parameters: {
      type: 'object',
      properties: { offer_id: { type: 'string' } },
      required: ['offer_id'],
    },
    speak_during_execution: false,
    speak_after_execution: true,
    timeout_ms: 60000,
  },
];

async function main() {
  const apiKey = process.env.RETELL_API_KEY;
  const llmId = process.env.LLM_ID ?? 'llm_daa9e8aee1f24a30f0bfff908ed9';
  if (!apiKey) {
    console.error('Falta RETELL_API_KEY en env.');
    process.exit(1);
  }

  const getRes = await fetch(`${RETELL_API}/get-retell-llm/${llmId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!getRes.ok) {
    console.error(`[retell] get LLM ${llmId} falló:`, getRes.status, await getRes.text());
    process.exit(1);
  }
  const llm = (await getRes.json()) as { general_tools?: RetellTool[] };
  const existing = llm.general_tools ?? [];

  const existingNames = new Set(existing.map((t) => t.name));
  const toAdd = NEW_TOOLS.filter((t) => !existingNames.has(t.name));
  if (toAdd.length === 0) {
    console.log('[retell] todas las tools ya existen, no hay cambios');
    return;
  }

  const next = [...existing, ...toAdd];
  console.log('[retell] agregando tools:', toAdd.map((t) => t.name).join(', '));

  const patchRes = await fetch(`${RETELL_API}/update-retell-llm/${llmId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ general_tools: next }),
  });
  if (!patchRes.ok) {
    console.error('[retell] update falló:', patchRes.status, await patchRes.text());
    process.exit(1);
  }
  console.log('[retell] ok');
}

main().catch((err) => {
  console.error('[retell] fatal', err);
  process.exit(1);
});
