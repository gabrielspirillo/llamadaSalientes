import 'server-only';
import { z } from 'zod';

import { type KnownToolName, dispatchTool } from '@/lib/retell/tools';

import type { ToolCallTrace } from './types';

/**
 * Wrapper de las tools del agente WhatsApp.
 *
 * - Reusamos las 8 herramientas ya implementadas en `lib/retell/tools.ts`
 *   (check_availability, book_appointment, cancel_appointment, get_patient_info,
 *   register_patient, list_treatments, get_treatment_details, search_faqs).
 *   Toda la lógica de GHL, calendarios, FAQs y validación de IDs ya está allí.
 * - Añadimos 2 herramientas propias del canal:
 *     request_handoff  → TERMINAL: marca conversación HANDOFF (sin urgencia)
 *                        y corta el loop con la respuesta estándar.
 *     flag_urgent      → MARCADOR (no terminal): marca la conversación como
 *                        URGENT pero NO corta el loop. El agente debe seguir
 *                        y agendar una cita de urgencia en el primer hueco.
 *   Ninguna tiene lado-server (no llaman a GHL); el orquestador detecta su
 *   invocación y setea los flags del run.
 *
 * Exponemos:
 *   - getAgentToolDefinitions(): JSON-schemas para tool-calling del LLM
 *     (compatible con Gemini functionDeclarations y OpenAI tools).
 *   - executeAgentTool(name, rawArgs, tenantId): valida con Zod, dispatch a
 *     la implementación correspondiente, devuelve un ToolCallTrace listo
 *     para persistir en whatsapp_agent_runs.tools_called.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas de cada tool (validación strict de args del LLM)
// ─────────────────────────────────────────────────────────────────────────────

const checkAvailabilityArgs = z.object({
  treatment_name: z.string().min(1),
  preferred_date: z.string().min(1),
  calendar_id: z.string().optional(),
});

const bookAppointmentArgs = z.object({
  contact_id: z.string().optional(),
  phone: z.string().optional(),
  calendar_id: z.string().optional(),
  start_time: z.string().min(1),
  treatment_name: z.string().min(1),
});

const cancelAppointmentArgs = z.object({
  appointment_id: z.string().min(1),
});

const getPatientInfoArgs = z.object({
  phone: z.string().min(1),
});

const registerPatientArgs = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  phone: z.string().min(1),
  email: z.string().optional(),
});

const listTreatmentsArgs = z.object({}).strict();

const getTreatmentDetailsArgs = z.object({
  name: z.string().min(1),
});

const searchFaqsArgs = z.object({
  query: z.string().min(1),
});

const requestHandoffArgs = z.object({
  reason: z.string().min(1).max(280),
});

const flagUrgentArgs = z.object({
  reason: z.string().min(1).max(280),
});

const SCHEMAS = {
  check_availability: checkAvailabilityArgs,
  book_appointment: bookAppointmentArgs,
  cancel_appointment: cancelAppointmentArgs,
  get_patient_info: getPatientInfoArgs,
  register_patient: registerPatientArgs,
  list_treatments: listTreatmentsArgs,
  get_treatment_details: getTreatmentDetailsArgs,
  search_faqs: searchFaqsArgs,
  request_handoff: requestHandoffArgs,
  flag_urgent: flagUrgentArgs,
} as const;

export type AgentToolName = keyof typeof SCHEMAS;

// Solo request_handoff corta el loop. flag_urgent es un MARCADOR: setea el
// flag urgent del run pero deja seguir al agente para que agende la cita de
// urgencia (no es terminal).
export const TERMINAL_TOOL_NAMES: ReadonlySet<AgentToolName> = new Set(['request_handoff']);

// ─────────────────────────────────────────────────────────────────────────────
// JSON Schema definitions para el LLM (Gemini + OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  /** JSON Schema draft-07 compatible. Sin $schema ni $id. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

/**
 * Definiciones de las tools tal cual las consumen Gemini (functionDeclarations)
 * y OpenAI (tools[].function). Mantenemos JSON Schema estricto (draft-07) sin
 * `$schema`/`$id` porque ambos providers lo rechazan.
 */
export function getAgentToolDefinitions(): AgentToolDefinition[] {
  return [
    {
      name: 'check_availability',
      description:
        'Devuelve hasta 4 huecos libres en el calendario de la clínica para un tratamiento y una fecha. Úsala cuando el paciente pregunte cuándo hay hueco o pida un día concreto.',
      parameters: {
        type: 'object',
        properties: {
          treatment_name: {
            type: 'string',
            description:
              'Nombre del tratamiento exactamente como aparece en el catálogo (ej: "Limpieza", "Revisión").',
          },
          preferred_date: {
            type: 'string',
            description:
              'Fecha que pide el paciente en formato YYYY-MM-DD. Si dice "mañana" calcúlala tú a partir de la fecha actual del system prompt.',
          },
          calendar_id: {
            type: 'string',
            description: 'Opcional. ID del calendario GHL si ya lo conoces.',
          },
        },
        required: ['treatment_name', 'preferred_date'],
        additionalProperties: false,
      },
    },
    {
      name: 'book_appointment',
      description:
        'Reserva una cita en el calendario tras haber confirmado horario, tratamiento y contact_id real del paciente.',
      parameters: {
        type: 'object',
        properties: {
          contact_id: {
            type: 'string',
            description:
              'ID GHL del paciente (alfanumérico ~20 chars). OBLIGATORIO en la práctica — obtenlo con get_patient_info o register_patient.',
          },
          phone: {
            type: 'string',
            description:
              'Teléfono E.164 del paciente (fallback si no tienes contact_id; intentaremos resolver por teléfono).',
          },
          start_time: {
            type: 'string',
            description:
              'Usa EXACTAMENTE el valor start_time (el que viene entre corchetes [start_time=...]) que devolvió check_availability para el hueco que eligió el paciente. NO lo recalcules, NO cambies la zona horaria ni lo deduzcas del texto hablado: cópialo tal cual.',
          },
          treatment_name: {
            type: 'string',
            description: 'Nombre exacto del tratamiento.',
          },
          calendar_id: {
            type: 'string',
            description: 'Opcional. ID del calendario GHL si ya lo conoces.',
          },
        },
        required: ['start_time', 'treatment_name'],
        additionalProperties: false,
      },
    },
    {
      name: 'cancel_appointment',
      description:
        'Cancela una cita existente en el calendario. Solo si tienes el appointment_id (no lo inventes).',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: {
            type: 'string',
            description: 'ID GHL de la cita.',
          },
        },
        required: ['appointment_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_patient_info',
      description:
        'Busca un paciente en GHL por su teléfono. Devuelve contact_id + nombre si existe. Úsala antes de book_appointment o cancel_appointment.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Teléfono del paciente en formato E.164 (ej: +34699123456).',
          },
        },
        required: ['phone'],
        additionalProperties: false,
      },
    },
    {
      name: 'register_patient',
      description:
        'Crea un nuevo paciente en GHL si get_patient_info no lo encontró. Devuelve el contact_id recién creado para usarlo en book_appointment.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['first_name', 'phone'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_treatments',
      description:
        'Devuelve la lista completa de tratamientos activos de la clínica con duración y precio. Úsala cuando el paciente pregunte "¿qué tratamientos hacéis?".',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'get_treatment_details',
      description: 'Devuelve la descripción detallada de un tratamiento concreto del catálogo.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del tratamiento.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_faqs',
      description:
        'Busca en las FAQs de la clínica por palabras clave. Úsala SIEMPRE antes de inventar una respuesta a una pregunta general.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Palabra clave o pregunta corta del paciente.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'request_handoff',
      description:
        'Marca la conversación para que la atienda una persona de recepción. Úsala para (a) interlocutores que no son pacientes — proveedores, mutuas, postulantes, prensa, administración, número equivocado, familiar de paciente preguntando por otro — y (b) consultas de paciente fuera de tu grounding (queja, factura, doctor específico, asunto legal).',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Motivo del handoff con tag tipificado al inicio entre corchetes. Tags válidos: proveedor, profesional, mutua, postulante, prensa, administracion, equivocado, familiar, otro. Ejemplos: "[proveedor] Empresa XYZ ofrece insumos dentales, quiere hablar con compras", "[mutua] Adeslas pide confirmación de cobertura para paciente Juan García", "[otro] Paciente pregunta por factura de junio, no tengo acceso al sistema de facturación".',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
    {
      name: 'flag_urgent',
      description:
        'Marca la conversación como URGENTE clínica (dolor, molestia fuerte, urgencia dental). NO corta la conversación: después de llamarla haz 2-3 preguntas breves sobre el síntoma, ofrece los horarios más cercanos con check_availability y, cuando el paciente elija uno, agenda con get_patient_info/register_patient + book_appointment. Úsala ante dolor, hinchazón, sangrado, infección, traumatismo o cualquier molestia que el paciente describa como urgente.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Síntoma reportado por el paciente (sin diagnosticar).',
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Ejecución
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecuteToolInput {
  tenantId: string;
  toolName: string;
  rawArgs: unknown;
}

/**
 * Ejecuta una tool del agente y devuelve un ToolCallTrace listo para
 * persistir en `whatsapp_agent_runs.tools_called`. No lanza: cualquier
 * error de validación o ejecución se devuelve con `ok=false`. El LLM verá
 * el `result` como observación y podrá corregir el rumbo.
 */
export async function executeAgentTool(input: ExecuteToolInput): Promise<ToolCallTrace> {
  const started = Date.now();
  const name = input.toolName;

  if (!isKnownTool(name)) {
    return {
      name,
      args: asArgsRecord(input.rawArgs),
      ok: false,
      result: `Herramienta desconocida: ${name}`,
      latencyMs: Date.now() - started,
      error: 'unknown_tool',
    };
  }

  const schema = SCHEMAS[name];
  const parsed = schema.safeParse(input.rawArgs ?? {});
  if (!parsed.success) {
    const message = formatZodError(parsed.error);
    return {
      name,
      args: asArgsRecord(input.rawArgs),
      ok: false,
      result: `Argumentos inválidos para ${name}: ${message}`,
      latencyMs: Date.now() - started,
      error: 'invalid_args',
    };
  }

  const args = parsed.data as Record<string, unknown>;

  // request_handoff (terminal) y flag_urgent (marcador) no llaman a GHL. El
  // orquestador detecta la invocación y setea los flags del run; nosotros sólo
  // dejamos el trace para auditoría. A flag_urgent le devolvemos una
  // observación que recuerda al LLM que aún tiene que agendar la cita.
  if (name === 'request_handoff' || name === 'flag_urgent') {
    return {
      name,
      args,
      ok: true,
      result:
        name === 'flag_urgent'
          ? 'URGENT marcado. Ahora haz 2-3 preguntas breves sobre el síntoma; luego ofrece 2-3 horarios cercanos con check_availability y, cuando el paciente elija uno, reserva con book_appointment.'
          : 'HANDOFF marcado',
      latencyMs: Date.now() - started,
    };
  }

  try {
    const result = await dispatchTool(input.tenantId, name as KnownToolName, args);
    return {
      name,
      args,
      ok: true,
      result: result.result,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const message = (err as Error).message ?? 'unknown_error';
    return {
      name,
      args,
      ok: false,
      result: `Error ejecutando ${name}: ${message}`,
      latencyMs: Date.now() - started,
      error: message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

function isKnownTool(name: string): name is AgentToolName {
  return name in SCHEMAS;
}

function asArgsRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return { raw: String(raw) };
}

function formatZodError(err: z.ZodError): string {
  return err.errors
    .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
    .join('; ')
    .slice(0, 220);
}
