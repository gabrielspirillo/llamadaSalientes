import { z } from 'zod';

import type { InboundMessageType, NormalizedInboundMessage } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Cloud API payload — schema mínimo de lo que necesitamos
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
// ─────────────────────────────────────────────────────────────────────────────

const cloudMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  audio: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  video: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  document: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  sticker: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number(), name: z.string().optional() })
    .optional(),
  interactive: z.unknown().optional(),
});

const cloudChangeValueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string(),
  }),
  contacts: z
    .array(
      z.object({
        profile: z.object({ name: z.string().optional() }).optional(),
        wa_id: z.string(),
      }),
    )
    .optional(),
  messages: z.array(cloudMessageSchema).optional(),
});

export const cloudWebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: cloudChangeValueSchema,
        }),
      ),
    }),
  ),
});

type CloudMessage = z.infer<typeof cloudMessageSchema>;

function cloudMessageType(type: string): InboundMessageType {
  switch (type) {
    case 'text':
      return 'TEXT';
    case 'image':
      return 'IMAGE';
    case 'audio':
      return 'AUDIO';
    case 'video':
      return 'VIDEO';
    case 'document':
      return 'PDF';
    case 'sticker':
      return 'STICKER';
    case 'location':
      return 'LOCATION';
    case 'contacts':
      return 'CONTACT';
    case 'interactive':
    case 'button':
      return 'INTERACTIVE';
    default:
      return 'SYSTEM';
  }
}

export function normalizeCloudMessage(
  msg: CloudMessage,
  tenantId: string,
  contactName: string | null,
): NormalizedInboundMessage {
  const type = cloudMessageType(msg.type);
  const media =
    msg.image ?? msg.audio ?? msg.video ?? msg.document ?? msg.sticker ?? null;
  const text =
    msg.text?.body ??
    (msg.location
      ? `📍 ${msg.location.name ?? ''} (${msg.location.latitude}, ${msg.location.longitude})`
      : null);

  return {
    tenantId,
    providerMessageId: msg.id,
    fromPhoneE164: ensureE164(msg.from),
    channel: 'WHATSAPP_CLOUD',
    type,
    text,
    mediaId: media?.id ?? null,
    mediaMimeType: media?.mime_type ?? null,
    contactName,
    timestamp: new Date(Number(msg.timestamp) * 1000),
    raw: msg,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Evolution API payload
// Docs: https://doc.evolution-api.com/
// ─────────────────────────────────────────────────────────────────────────────

const evolutionKeySchema = z.object({
  remoteJid: z.string(),
  fromMe: z.boolean(),
  id: z.string(),
});

const evolutionMessageContentSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string() }).optional(),
  imageMessage: z.object({ caption: z.string().optional(), mimetype: z.string().optional() }).optional(),
  audioMessage: z.object({ mimetype: z.string().optional() }).optional(),
  videoMessage: z.object({ caption: z.string().optional(), mimetype: z.string().optional() }).optional(),
  documentMessage: z
    .object({ caption: z.string().optional(), mimetype: z.string().optional(), fileName: z.string().optional() })
    .optional(),
  stickerMessage: z.object({ mimetype: z.string().optional() }).optional(),
});

export const evolutionMessagesUpsertSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: evolutionKeySchema,
    pushName: z.string().optional(),
    messageTimestamp: z.union([z.number(), z.string()]).optional(),
    message: evolutionMessageContentSchema.optional(),
    messageType: z.string().optional(),
  }),
});

type EvolutionUpsert = z.infer<typeof evolutionMessagesUpsertSchema>;

function evolutionMessageType(data: EvolutionUpsert['data']): InboundMessageType {
  const m = data.message ?? {};
  if (m.conversation || m.extendedTextMessage) return 'TEXT';
  if (m.imageMessage) return 'IMAGE';
  if (m.audioMessage) return 'AUDIO';
  if (m.videoMessage) return 'VIDEO';
  if (m.documentMessage) return 'PDF';
  if (m.stickerMessage) return 'STICKER';
  return 'SYSTEM';
}

function evolutionText(data: EvolutionUpsert['data']): string | null {
  const m = data.message ?? {};
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}

function evolutionMediaInfo(
  data: EvolutionUpsert['data'],
): { mimeType: string | null } {
  const m = data.message ?? {};
  const mimeType =
    m.imageMessage?.mimetype ??
    m.audioMessage?.mimetype ??
    m.videoMessage?.mimetype ??
    m.documentMessage?.mimetype ??
    m.stickerMessage?.mimetype ??
    null;
  return { mimeType };
}

export function normalizeEvolutionMessage(
  payload: EvolutionUpsert,
  tenantId: string,
): NormalizedInboundMessage {
  const { key, pushName, messageTimestamp } = payload.data;
  const remoteJid = key.remoteJid;
  // remoteJid suele venir como "5491155555555@s.whatsapp.net"
  const phone = remoteJid.split('@')[0] ?? remoteJid;
  const ts =
    typeof messageTimestamp === 'number'
      ? messageTimestamp
      : Number(messageTimestamp ?? Date.now() / 1000);
  const { mimeType } = evolutionMediaInfo(payload.data);

  return {
    tenantId,
    providerMessageId: key.id,
    fromPhoneE164: ensureE164(phone),
    channel: 'WHATSAPP_EVOLUTION',
    type: evolutionMessageType(payload.data),
    text: evolutionText(payload.data),
    // Evolution: el mediaId es el mismo key.id (se pasa de vuelta a /getBase64FromMediaMessage).
    mediaId: payload.data.message ? key.id : null,
    mediaMimeType: mimeType,
    contactName: pushName ?? null,
    timestamp: new Date(ts * 1000),
    raw: payload.data,
  };
}

function ensureE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  // Heurística mínima: si solo viene el número con dígitos, prefijamos '+'.
  if (/^\d{6,15}$/.test(trimmed)) return `+${trimmed}`;
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Twilio Programmable Messaging (WhatsApp)
// Docs: https://www.twilio.com/docs/messaging/guides/webhook-request
// Twilio entrega payload form-encoded con campos como From, To, Body, NumMedia,
// MediaUrl{N}, MediaContentType{N}, ProfileName, MessageSid, WaId, SmsStatus.
// ─────────────────────────────────────────────────────────────────────────────

export const twilioInboundFormSchema = z.object({
  MessageSid: z.string(),
  From: z.string(),
  To: z.string(),
  Body: z.string().optional(),
  NumMedia: z.string().optional(),
  MediaUrl0: z.string().optional(),
  MediaContentType0: z.string().optional(),
  ProfileName: z.string().optional(),
  WaId: z.string().optional(),
  SmsStatus: z.string().optional(),
});

export type TwilioInboundForm = z.infer<typeof twilioInboundFormSchema>;

function twilioMessageType(form: TwilioInboundForm): InboundMessageType {
  const numMedia = Number(form.NumMedia ?? '0');
  if (numMedia === 0) return form.Body ? 'TEXT' : 'SYSTEM';
  const mime = form.MediaContentType0 ?? '';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/webp')) return 'STICKER';
  return 'SYSTEM';
}

/**
 * Convierte el payload Twilio en `NormalizedInboundMessage`.
 * `From` viene como "whatsapp:+E164"; lo despojamos del prefijo.
 * Para media usamos `MediaUrl0` directamente como `mediaId` porque Twilio
 * entrega la URL completa con auth requerida — el connector la descarga
 * usando Basic auth con el SID/Token de la cuenta.
 */
export function normalizeTwilioMessage(
  form: TwilioInboundForm,
  tenantId: string,
): NormalizedInboundMessage {
  const fromRaw = form.From.replace(/^whatsapp:/, '');
  return {
    tenantId,
    providerMessageId: form.MessageSid,
    fromPhoneE164: ensureE164(fromRaw),
    channel: 'WHATSAPP_TWILIO',
    type: twilioMessageType(form),
    text: form.Body ?? null,
    mediaId: form.MediaUrl0 ?? null,
    mediaMimeType: form.MediaContentType0 ?? null,
    contactName: form.ProfileName ?? null,
    timestamp: new Date(),
    raw: form,
  };
}
