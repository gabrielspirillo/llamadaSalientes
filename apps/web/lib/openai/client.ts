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
