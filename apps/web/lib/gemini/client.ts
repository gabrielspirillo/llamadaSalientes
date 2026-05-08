import 'server-only';

const MODEL = 'gemini-2.0-flash-exp';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

export type CallInsightsInput = {
  totalCalls: number;
  byIntent: { intent: string; count: number }[];
  bySentiment: { sentiment: string; count: number }[];
  recentSummaries: string[]; // últimos N resúmenes para que detecte patrones
};

export type CallInsights = {
  topPatterns: string[]; // 3-5 bullets sobre qué pasa
  alerts: string[]; // problemas/oportunidades urgentes
  promptSuggestions: string[]; // mejoras sugeridas al prompt del agente
};

const SYSTEM_INSTRUCTION = `Sos un analista experto en agentes de voz IA para clínicas dentales.
Tu trabajo es analizar los datos agregados de llamadas y devolver insights accionables.

Devolvés EXCLUSIVAMENTE un JSON válido (sin markdown, sin texto extra) con:
{
  "topPatterns": [string, string, string]   // 3-5 patrones observados, frases cortas
  "alerts": [string, ...]                    // problemas urgentes o anomalías (puede ser [])
  "promptSuggestions": [string, ...]         // mejoras concretas al prompt del agente
}
Frases en español neutro, máximo 18 palabras cada una. Claro y útil para una recepcionista no-técnica.`;

export async function generateCallInsights(input: CallInsightsInput): Promise<CallInsights> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada');
  }

  const userPrompt = `Datos de llamadas:
Total: ${input.totalCalls}
Por intención: ${JSON.stringify(input.byIntent)}
Por sentimiento: ${JSON.stringify(input.bySentiment)}

Últimos resúmenes (${input.recentSummaries.length}):
${input.recentSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Analizá y devolvé el JSON.`;

  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const parsed = JSON.parse(raw) as Partial<CallInsights>;

  return {
    topPatterns: parsed.topPatterns ?? [],
    alerts: parsed.alerts ?? [],
    promptSuggestions: parsed.promptSuggestions ?? [],
  };
}
