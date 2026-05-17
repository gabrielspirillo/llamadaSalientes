import 'server-only';
import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

/**
 * Transcripción de audio con OpenAI Whisper.
 *
 * Lo usa el procesador multimodal para convertir notas de voz de WhatsApp
 * (audio/ogg con codec opus típicamente) en texto que se concatena al input
 * del LLM. La transcripción se cachea en `whatsapp_messages.transcription`
 * para que retries de Inngest sean idempotentes.
 *
 * Lenguaje por defecto: castellano. Override vía `options.language`.
 */

const DEFAULT_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1';

let _client: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no está configurada');
  _client = new OpenAI({ apiKey });
  return _client;
}

export type TranscribeResult = {
  text: string;
  model: string;
  latencyMs: number;
};

/**
 * Mapea el mime-type que entrega WhatsApp a una extensión que la API de
 * Whisper acepta. La API valida la extensión del filename, no solo el mime.
 * WhatsApp Cloud entrega `audio/ogg; codecs=opus` por defecto.
 */
function audioExtForMime(mime: string): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('m4a')) return 'm4a';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  // WhatsApp Cloud envía audio/ogg si no hay info de mime.
  return 'ogg';
}

export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  options: { language?: string } = {},
): Promise<TranscribeResult> {
  const started = Date.now();
  const openai = getOpenAI();
  const ext = audioExtForMime(mimeType);
  const file = await toFile(buffer, `audio.${ext}`, { type: mimeType || `audio/${ext}` });
  const res = await openai.audio.transcriptions.create({
    file,
    model: DEFAULT_MODEL,
    language: options.language ?? 'es',
    response_format: 'json',
  });
  return {
    text: (res.text ?? '').trim(),
    model: DEFAULT_MODEL,
    latencyMs: Date.now() - started,
  };
}
