import 'server-only';

import { OPENAI_MODEL } from '@/lib/openai/model';
import OpenAI from 'openai';

/**
 * Descripción de imágenes y PDFs con el modelo multimodal de OpenAI (el mismo
 * del asistente). Antes iba por Gemini Flash; la clínica pidió no usarlo para
 * nada (6/11/2026).
 *
 * El resultado se cachea en `whatsapp_messages.transcription` (descripción
 * en texto plano) + `whatsapp_messages.media_analysis_json` (model, latency,
 * mediaUrl). El procesador multimodal usa esos campos para idempotencia.
 *
 * IMPORTANTE: NO emitimos diagnósticos clínicos — solo descripción literal.
 * El system prompt del agente principal trata cualquier media clínico
 * sospechoso como handoff a recepción.
 */

/**
 * Tope de espera. Corre dentro del job `wa-process`, en bucle sobre cada
 * imagen o PDF de la ráfaga: un fetch colgado se lleva un slot de la cola de
 * WhatsApp para siempre —BullMQ renueva el lock mientras el handler sigue
 * vivo— y el paciente que mandó la foto no recibe respuesta nunca.
 */
const VISION_TIMEOUT_MS = 25_000;

const MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_MODEL;

const IMAGE_PROMPT = `Describe brevemente, en castellano, lo que ves en esta imagen.
Si es contenido médico u odontológico, explica qué se observa de forma DESCRIPTIVA y NEUTRAL
(ej: "se ve un molar con una zona oscura en la cara oclusal"). NO diagnostiques.
Máximo 3 frases. Sin emojis ni signos de exclamación.`;

const PDF_PROMPT = `Resume en castellano el contenido de este PDF, máximo 4 frases.
Si es un parte médico/odontológico, extrae los datos relevantes (fecha, paciente,
tratamiento, recomendaciones) de forma descriptiva, SIN diagnosticar ni inventar.
Sin emojis ni signos de exclamación.`;

export type VisionResult = {
  text: string;
  model: string;
  latencyMs: number;
};

let _client: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada');
  _client = new OpenAI({ apiKey, timeout: VISION_TIMEOUT_MS, maxRetries: 1 });
  return _client;
}

type ContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart;

async function describe(prompt: string, part: ContentPart): Promise<VisionResult> {
  const started = Date.now();
  const completion = await getOpenAI().chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, part] }],
  });
  const text = (completion.choices[0]?.message?.content ?? '').trim();
  return {
    text: text || '(media recibido, sin descripción)',
    model: MODEL,
    latencyMs: Date.now() - started,
  };
}

export async function describeImage(buffer: Buffer, mimeType: string): Promise<VisionResult> {
  // Algunos paquetes WhatsApp llegan con `image/jpeg; codecs=...`; el data URL
  // quiere el mime sin parámetros.
  const cleanMime = mimeType.split(';')[0]?.trim() || 'image/jpeg';
  return describe(IMAGE_PROMPT, {
    type: 'image_url',
    image_url: { url: `data:${cleanMime};base64,${buffer.toString('base64')}`, detail: 'low' },
  });
}

export async function describePdf(buffer: Buffer): Promise<VisionResult> {
  return describe(PDF_PROMPT, {
    type: 'file',
    file: {
      filename: 'documento.pdf',
      file_data: `data:application/pdf;base64,${buffer.toString('base64')}`,
    },
  });
}
