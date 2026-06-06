import 'server-only';
import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada');
  _client = new OpenAI({ apiKey });
  return _client;
}

export type CallSummary = {
  intent: string; // agendar | cancelar | reagendar | pregunta | queja | otro
  sentiment: 'positivo' | 'neutro' | 'negativo';
  summary: string; // 1-3 frases
  followUp: string | null; // acción pendiente para recepción humana, si aplica
};

const SYSTEM_PROMPT = `Eres un analista de conversaciones telefónicas de una clínica dental.
Recibís el transcript completo de una llamada entre un paciente y el agente de voz.
Devolvés EXCLUSIVAMENTE un JSON válido con este shape:
{
  "intent": "agendar" | "cancelar" | "reagendar" | "pregunta" | "queja" | "otro",
  "sentiment": "positivo" | "neutro" | "negativo",
  "summary": "1-3 frases en español neutro describiendo qué pasó en la llamada",
  "followUp": null o un string corto con acción pendiente que recepción debe hacer
}
NO agregues markdown, NO agregues texto fuera del JSON.`;

export async function summarizeCall(transcript: string): Promise<CallSummary> {
  if (!transcript || transcript.trim().length < 10) {
    return {
      intent: 'otro',
      sentiment: 'neutro',
      summary: 'Llamada demasiado corta para analizar.',
      followUp: null,
    };
  }

  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Transcript:\n\n${transcript}` },
    ],
  });

  const raw = completion.choices[0]?.message.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<CallSummary>;

  return {
    intent: parsed.intent ?? 'otro',
    sentiment: parsed.sentiment ?? 'neutro',
    summary: parsed.summary ?? 'Sin resumen disponible.',
    followUp: parsed.followUp ?? null,
  };
}

// ─── Memoria de lead (resumen rolling cross-canal) ────────────────────────────

export type LeadMemoryResult = {
  /** Resumen rolling del lead (4-8 frases). Se inyecta al agente. */
  profileSummary: string;
  /** Hechos estructurados (intereses, seguro, última cita, opt-outs, etc.). */
  facts: Record<string, unknown>;
};

const LEAD_MEMORY_SYSTEM = `Eres el sistema de memoria de un CRM de una clínica dental.
Recibís el PERFIL PREVIO de un lead (si existe) y su ACTIVIDAD RECIENTE multicanal
(mensajes de WhatsApp y/o resúmenes de llamadas entrantes/salientes). Tu trabajo es
producir una memoria ACTUALIZADA del lead, en español neutro.

Devolvés EXCLUSIVAMENTE un JSON válido con este shape:
{
  "profileSummary": "4-8 frases: quién es el lead, qué busca, estado actual, citas, y pendientes. Hechos estables + lo más reciente.",
  "facts": {
    "intereses": ["tratamientos o temas que mencionó"],
    "seguro": "aseguradora si la mencionó, o null",
    "ultima_cita": "fecha/estado de la última cita conocida, o null",
    "opt_outs": ["canales de los que pidió no ser contactado"],
    "sentimiento": "positivo | neutro | negativo",
    "notas": "cualquier dato operativo útil para recepción"
  }
}

Reglas:
- NO inventes datos que no estén en el material. Si no sabés algo, usá null o lista vacía.
- Conservá del perfil previo lo que siga vigente; integrá lo nuevo (no dupliques).
- Sé conciso y factual. NO incluyas el teléfono completo ni datos médicos sensibles.
- NO agregues markdown ni texto fuera del JSON.`;

export async function summarizeLeadMemory(input: {
  priorProfile: string | null;
  material: string;
}): Promise<LeadMemoryResult> {
  const openai = getOpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: LEAD_MEMORY_SYSTEM },
      {
        role: 'user',
        content: `PERFIL PREVIO:\n${input.priorProfile ?? '(sin perfil previo)'}\n\nACTIVIDAD RECIENTE:\n${input.material}`,
      },
    ],
  });
  const raw = completion.choices[0]?.message.content ?? '{}';
  const parsed = JSON.parse(raw) as Partial<LeadMemoryResult>;
  return {
    profileSummary: parsed.profileSummary ?? input.priorProfile ?? '',
    facts: (parsed.facts as Record<string, unknown>) ?? {},
  };
}
