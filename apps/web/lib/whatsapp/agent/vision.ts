import 'server-only';

/**
 * Descripción de imágenes y PDFs con Gemini multimodal.
 *
 * Reutilizamos el endpoint REST de Gemini (mismo patrón que
 * lib/gemini/client.ts) para no traer otra SDK. Por defecto usamos
 * `gemini-flash-latest` que ya está validado en el resto del proyecto y
 * soporta input multimodal. Override vía `GEMINI_VISION_MODEL` cuando
 * necesitemos algo más potente (ej: `gemini-pro-latest` para PDFs largos).
 *
 * El resultado se cachea en `whatsapp_messages.transcription` (descripción
 * en texto plano) + `whatsapp_messages.media_analysis_json` (model, latency,
 * mediaUrl). El procesador multimodal usa esos campos para idempotencia.
 *
 * IMPORTANTE: NO emitimos diagnósticos clínicos — solo descripción literal.
 * El system prompt del agente principal trata cualquier media clínico
 * sospechoso como handoff a recepción (regla #4 del CLAUDE.md de DentalFlow).
 */

const DEFAULT_MODEL = process.env.GEMINI_VISION_MODEL ?? 'gemini-flash-latest';

const IMAGE_PROMPT = `Describí brevemente, en castellano, lo que ves en esta imagen.
Si es contenido médico u odontológico, explicá qué se observa de forma DESCRIPTIVA y NEUTRAL
(ej: "se ve un molar con una zona oscura en la cara oclusal"). NO diagnostiques.
Máximo 3 frases. Sin emojis ni signos de exclamación.`;

const PDF_PROMPT = `Resumí en castellano el contenido de este PDF, máximo 4 frases.
Si es un parte médico/odontológico, extraé los datos relevantes (fecha, paciente,
tratamiento, recomendaciones) de forma descriptiva, SIN diagnosticar ni inventar.
Sin emojis ni signos de exclamación.`;

export type VisionResult = {
  text: string;
  model: string;
  latencyMs: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
};

async function generateFromInline(input: {
  prompt: string;
  buffer: Buffer;
  mimeType: string;
  model?: string;
}): Promise<VisionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY no está configurada');

  const model = input.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: input.prompt },
            { inlineData: { mimeType: input.mimeType, data: input.buffer.toString('base64') } },
          ],
        },
      ],
      generationConfig: { temperature: 0.2 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  // Bloqueo por safety filter: devolvemos un placeholder neutral para que el
  // procesador siga adelante (el LLM principal verá "imagen recibida sin
  // contenido analizable" y derivará a handoff si hace falta).
  if (data.promptFeedback?.blockReason) {
    return {
      text: '(media recibido, no se pudo analizar el contenido)',
      model,
      latencyMs: Date.now() - started,
    };
  }
  const text = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  return {
    text: text || '(media recibido, sin descripción)',
    model,
    latencyMs: Date.now() - started,
  };
}

export async function describeImage(buffer: Buffer, mimeType: string): Promise<VisionResult> {
  // Algunos paquetes WhatsApp llegan con `image/jpeg; codecs=...`; la API de
  // Gemini quiere el mime sin parámetros.
  const cleanMime = mimeType.split(';')[0]?.trim() || 'image/jpeg';
  return generateFromInline({ prompt: IMAGE_PROMPT, buffer, mimeType: cleanMime });
}

export async function describePdf(buffer: Buffer): Promise<VisionResult> {
  return generateFromInline({ prompt: PDF_PROMPT, buffer, mimeType: 'application/pdf' });
}
