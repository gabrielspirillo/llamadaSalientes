import 'server-only';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { whatsappMessages } from '@/lib/db/schema';
import { buildWhatsappMediaPath, mediaUpload } from '@/lib/storage/media';
import type { WhatsAppConnector } from '@/lib/whatsapp/types';

import type { MediaKind, MediaSummary, MultimodalOutput } from './types';
import { describeImage, describePdf } from './vision';
import { transcribeAudio } from './whisper';

/**
 * Procesador multimodal del agente de WhatsApp.
 *
 * Toma una ráfaga de mensajes inbound (lo que devuelve el debouncer en F5) y
 * la convierte en un texto unificado listo para alimentar al LLM. Maneja:
 *  - TEXT / INTERACTIVE / LOCATION / CONTACT: usa contentText tal cual.
 *  - AUDIO: descarga via connector → Whisper → cachea transcripción.
 *  - IMAGE / STICKER: descarga → Gemini Vision → cachea descripción.
 *  - PDF: descarga → Gemini Vision (PDF mode) → cachea descripción.
 *  - VIDEO: placeholder neutral (no procesamos contenido visual de video).
 *
 * Idempotencia:
 *  - Si `whatsapp_messages.transcription` ya tiene valor, se usa el cache.
 *  - Si descargamos el media y `mediaUrl` está null, lo subimos a Supabase
 *    Storage y persistimos `mediaUrl` para que el inbox UI lo muestre.
 *
 * Resiliencia:
 *  - Cualquier fallo de Whisper/Vision se captura por-mensaje: el media queda
 *    con un summary placeholder ("(audio recibido, no se pudo transcribir)")
 *    y el procesamiento de la ráfaga sigue. El LLM principal decidirá
 *    handoff cuando vea que no hay contexto.
 */

type DbMessage = typeof whatsappMessages.$inferSelect;

export interface ProcessMessagesInput {
  tenantId: string;
  conversationId: string;
  messages: DbMessage[];
  /**
   * Connector resuelto para el tenant. Si es null, no podemos descargar
   * media y los mensajes con adjunto quedan como placeholder. El job de
   * Inngest pasa null cuando el tenant aún no tiene una conexión activa.
   */
  connector: WhatsAppConnector | null;
}

const MEDIA_PLACEHOLDER: Record<MediaKind, string> = {
  text: '(sin contenido)',
  audio: '(audio recibido, no se pudo transcribir)',
  image: '(imagen recibida, no se pudo analizar)',
  document: '(documento recibido, no se pudo analizar)',
  video: '(video recibido)',
  sticker: '(sticker recibido)',
  unknown: '(media recibido)',
};

export async function processInboundMessages(
  input: ProcessMessagesInput,
): Promise<MultimodalOutput> {
  const sorted = [...input.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const firstAt = sorted[0]?.createdAt.getTime() ?? Date.now();
  const summaries: MediaSummary[] = [];
  const lines: string[] = [];
  const startedAll = Date.now();

  for (const msg of sorted) {
    const offsetSec = Math.max(0, Math.round((msg.createdAt.getTime() - firstAt) / 1000));
    const summary = await processOne(msg, input);
    summaries.push(summary);
    const marker = `[t+${offsetSec}s]`;
    const tag = summary.kind === 'text' ? '' : `(${summary.kind}) `;
    lines.push(`${marker} ${tag}${summary.summary}`.trim());
  }

  return {
    combinedText: lines.join('\n'),
    summaries,
    totalLatencyMs: Date.now() - startedAll,
  };
}

async function processOne(msg: DbMessage, input: ProcessMessagesInput): Promise<MediaSummary> {
  const kind = mediaKindForType(msg.type);

  // Tipos puramente texto: no requieren descarga ni LLM call.
  if (kind === 'text') {
    return {
      messageId: msg.id,
      kind: 'text',
      summary: (msg.contentText ?? '').trim() || MEDIA_PLACEHOLDER.text,
    };
  }

  // Cache hit: ya procesamos este media en un run previo.
  if (msg.transcription?.trim()) {
    return {
      messageId: msg.id,
      kind,
      summary: msg.transcription.trim(),
      mediaUrl: msg.mediaUrl ?? undefined,
      model: 'cache',
    };
  }

  // Video / sticker: no procesamos contenido. Persistimos placeholder para
  // que el cache funcione en el siguiente run.
  if (kind === 'video' || kind === 'sticker' || kind === 'unknown') {
    const fallback = MEDIA_PLACEHOLDER[kind];
    await persistAnalysis(msg.id, {
      transcription: fallback,
      mediaUrl: msg.mediaUrl,
      analysis: { kind, model: 'noop' },
    });
    return { messageId: msg.id, kind, summary: fallback, mediaUrl: msg.mediaUrl ?? undefined };
  }

  // Audio / Image / Document: necesitamos descargar.
  if (!input.connector) {
    return { messageId: msg.id, kind, summary: MEDIA_PLACEHOLDER[kind] };
  }

  const mediaId = extractMediaId(msg);
  if (!mediaId) {
    return { messageId: msg.id, kind, summary: MEDIA_PLACEHOLDER[kind] };
  }

  let buffer: Buffer;
  let mimeType: string;
  try {
    const media = await input.connector.downloadMedia(mediaId);
    buffer = media.buffer;
    mimeType = media.mimeType || msg.mediaType || defaultMimeForKind(kind);
  } catch (err) {
    console.warn('[wa-multimodal] downloadMedia falló', {
      messageId: msg.id,
      mediaId,
      err: (err as Error).message,
    });
    return { messageId: msg.id, kind, summary: MEDIA_PLACEHOLDER[kind] };
  }

  // Persistimos el adjunto en el bucket S3 (MinIO) si no estaba ya. Esto
  // deja el mediaUrl disponible para el inbox UI. Si el storage no está
  // configurado (env vacío) cae al catch y seguimos sin URL — el LLM no lo
  // necesita.
  let mediaUrl: string | null = msg.mediaUrl ?? null;
  if (!mediaUrl) {
    try {
      const ext = extForMime(mimeType, kind);
      const path = buildWhatsappMediaPath(input.tenantId, input.conversationId, ext);
      const uploaded = await mediaUpload({ path, body: buffer, contentType: mimeType });
      mediaUrl = uploaded.publicUrl;
    } catch (err) {
      console.warn('[wa-multimodal] mediaUpload falló (sigo sin URL)', {
        messageId: msg.id,
        err: (err as Error).message,
      });
    }
  }

  // LLM call: Whisper para audio, Gemini Vision para imagen/PDF.
  let summaryText = MEDIA_PLACEHOLDER[kind];
  let modelUsed = 'noop';
  let latencyMs = 0;
  try {
    if (kind === 'audio') {
      const r = await transcribeAudio(buffer, mimeType, { language: 'es' });
      summaryText = r.text || MEDIA_PLACEHOLDER.audio;
      modelUsed = r.model;
      latencyMs = r.latencyMs;
    } else if (kind === 'image') {
      const r = await describeImage(buffer, mimeType);
      summaryText = r.text || MEDIA_PLACEHOLDER.image;
      modelUsed = r.model;
      latencyMs = r.latencyMs;
    } else if (kind === 'document') {
      const r = await describePdf(buffer);
      summaryText = r.text || MEDIA_PLACEHOLDER.document;
      modelUsed = r.model;
      latencyMs = r.latencyMs;
    }
  } catch (err) {
    console.warn('[wa-multimodal] LLM call falló', {
      messageId: msg.id,
      kind,
      err: (err as Error).message,
    });
    // Caemos al placeholder pero igual persistimos mediaUrl si lo conseguimos.
  }

  await persistAnalysis(msg.id, {
    transcription: summaryText,
    mediaUrl,
    analysis: { kind, model: modelUsed, latencyMs, mediaUrl },
  });

  return {
    messageId: msg.id,
    kind,
    summary: summaryText,
    mediaUrl: mediaUrl ?? undefined,
    model: modelUsed,
    latencyMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mediaKindForType(type: DbMessage['type']): MediaKind {
  switch (type) {
    case 'TEXT':
    case 'INTERACTIVE':
    case 'LOCATION':
    case 'CONTACT':
    case 'TEMPLATE':
    case 'SYSTEM':
      return 'text';
    case 'AUDIO':
      return 'audio';
    case 'IMAGE':
      return 'image';
    case 'PDF':
      return 'document';
    case 'VIDEO':
      return 'video';
    case 'STICKER':
      return 'sticker';
    default:
      return 'unknown';
  }
}

/**
 * Extrae el identificador descargable del media del mensaje, mirando rawJson.
 *
 * Cada provider expone el media de forma distinta:
 *  - Cloud (Meta):    rawJson.{image|audio|video|document|sticker}.id
 *  - Evolution API:   externalId es el `key.id`, que también se usa para
 *                     /chat/getBase64FromMediaMessage.
 *  - Twilio:          rawJson.MediaUrl0 — URL completa autenticada.
 *                     downloadMedia espera la URL completa, no un id.
 */
function extractMediaId(msg: DbMessage): string | null {
  const raw = (msg.rawJson ?? {}) as Record<string, unknown>;

  // Twilio: MediaUrl0 viene en el form-encoded del webhook.
  const twilioUrl = raw.MediaUrl0;
  if (typeof twilioUrl === 'string' && twilioUrl) return twilioUrl;

  // Cloud: anidamos por tipo de media. Cada uno tiene .id.
  for (const key of ['image', 'audio', 'video', 'document', 'sticker'] as const) {
    const node = raw[key];
    if (node && typeof node === 'object') {
      const id = (node as { id?: unknown }).id;
      if (typeof id === 'string' && id) return id;
    }
  }

  // Evolution: el externalId que ya tenemos en DB es el key.id que usa la API
  // para descargar el media.
  if (msg.externalId) return msg.externalId;

  return null;
}

function defaultMimeForKind(kind: MediaKind): string {
  switch (kind) {
    case 'audio':
      return 'audio/ogg';
    case 'image':
      return 'image/jpeg';
    case 'document':
      return 'application/pdf';
    case 'video':
      return 'video/mp4';
    case 'sticker':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function extForMime(mime: string, kind: MediaKind): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4')) return kind === 'audio' ? 'm4a' : 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('pdf')) return 'pdf';
  return 'bin';
}

async function persistAnalysis(
  messageId: string,
  patch: {
    transcription: string;
    mediaUrl: string | null;
    analysis: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db
      .update(whatsappMessages)
      .set({
        transcription: patch.transcription,
        mediaUrl: patch.mediaUrl,
        mediaAnalysisJson: patch.analysis,
      })
      .where(eq(whatsappMessages.id, messageId));
  } catch (err) {
    // No tiramos la ráfaga entera si el update falla; el LLM ya tiene el
    // texto en memoria. El próximo run reintentará el análisis.
    console.warn('[wa-multimodal] persistAnalysis falló', {
      messageId,
      err: (err as Error).message,
    });
  }
}
