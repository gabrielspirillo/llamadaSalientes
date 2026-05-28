import 'server-only';
import OpenAI from 'openai';

// Parser de intención de la llamada de recordatorio.
//
// Mira el transcript completo y devuelve la acción que el paciente expresó
// (confirm / reschedule / cancel / none) con un score de confianza.
//
// Para evitar falsos positivos ("cancela mi otra cita"), el umbral de
// confidence debe ser ≥ 0.7 para que el caller actúe.

export type ReminderVoiceIntent = {
  action: 'confirm' | 'reschedule' | 'cancel' | 'none';
  confidence: number; // 0..1
  reasoning?: string;
  // Snippet del transcript que justifica la acción, para auditoría.
  snippet?: string;
};

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada');
  _client = new OpenAI({ apiKey });
  return _client;
}

const SYSTEM_PROMPT = `Eres un clasificador de transcripts de llamadas de recordatorio dental.
La clínica llamó al paciente para confirmar una cita. Tu tarea es identificar
qué acción expresó claramente el paciente respecto a ESA cita específica.

Devuelve EXCLUSIVAMENTE un JSON con este shape:
{
  "action": "confirm" | "reschedule" | "cancel" | "none",
  "confidence": 0..1,
  "reasoning": "1-2 frases breve",
  "snippet": "frase exacta del transcript que justifica la acción (máx 120 chars)"
}

Reglas:
- "confirm": el paciente dice claramente que asistirá ("sí, ahí estaré", "perfecto", "confirmado").
- "reschedule": pide cambiar fecha/hora ("no me viene bien", "para otro día", "puedo el lunes?").
- "cancel": cancela sin reagendar ("no podré ir", "cancélala", "no me interesa").
- "none": no se entendió la respuesta, colgó, buzón, o el tema no fue su cita.
- confidence baja (<0.7) si hay ambigüedad o el paciente habla de OTRA cita.
- NO markdown, NO texto fuera del JSON.`;

export async function parseReminderVoiceIntent(
  transcript: string,
): Promise<ReminderVoiceIntent> {
  if (!transcript || transcript.trim().length < 10) {
    return { action: 'none', confidence: 0 };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { action: 'none', confidence: 0 };
  }

  try {
    const openai = getClient();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Transcript:\n\n${transcript}` },
      ],
    });

    const raw = completion.choices[0]?.message.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<ReminderVoiceIntent>;
    const action = (parsed.action ?? 'none') as ReminderVoiceIntent['action'];
    const confidence = clamp01(Number(parsed.confidence ?? 0));
    if (!['confirm', 'reschedule', 'cancel', 'none'].includes(action)) {
      return { action: 'none', confidence: 0 };
    }
    return {
      action,
      confidence,
      reasoning: parsed.reasoning,
      snippet: parsed.snippet?.slice(0, 200),
    };
  } catch (err) {
    console.warn('[parseReminderVoiceIntent] failed', err);
    return { action: 'none', confidence: 0 };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
