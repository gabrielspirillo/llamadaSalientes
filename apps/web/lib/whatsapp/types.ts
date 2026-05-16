/**
 * Tipos compartidos para los drivers de WhatsApp.
 *
 * Dos drivers concretos detrás del interface `WhatsAppConnector`:
 *  - WhatsAppCloudConnector: Meta Graph API v21+ (oficial)
 *  - EvolutionConnector: Evolution API (self-hosted, Baileys, no oficial)
 *
 * El interface se mantiene mínimo y común denominador. Cualquier feature
 * exclusiva de un driver se implementa en métodos extra del driver concreto.
 */

import { z } from 'zod';

/** Identifica un mensaje saliente devuelto por el provider. */
export interface MessageId {
  /** ID interno del provider (wamid del Cloud API o key.id de Evolution). */
  id: string;
  /** Driver que generó el id, útil para tracing. */
  channel: 'whatsapp_cloud' | 'whatsapp_evolution' | 'whatsapp_twilio';
}

/** Botón interactivo de WhatsApp (max 3 botones, max 20 chars cada uno). */
export interface InteractiveButton {
  /** ID que identifica al botón en el callback (max 256 chars). */
  id: string;
  /** Texto visible del botón (max 20 chars según docs Meta). */
  title: string;
}

export const interactiveButtonSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(20),
});

/** Item dentro de una sección de lista. */
export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/** Sección de un mensaje tipo lista (max 10 secciones, max 10 rows total). */
export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface TemplateParam {
  type: 'text' | 'currency' | 'date_time';
  value: string;
}

export interface TemplateParams {
  /** Código BCP-47, ej: "es", "es_ES". */
  language: string;
  body?: TemplateParam[];
  header?: TemplateParam[];
  buttons?: TemplateParam[][];
}

/** Resultado de descargar un asset de WhatsApp (audio, imagen, PDF, video). */
export interface MediaResult {
  buffer: Buffer;
  mimeType: string;
  /** Tamaño declarado por el provider (puede no coincidir con buffer.length). */
  sizeBytes?: number;
}

export type SendMediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

/**
 * Contrato común para enviar/recibir mensajes WhatsApp.
 * Cada driver implementa rate limiting interno y errores tipados.
 */
export interface WhatsAppConnector {
  readonly channel: 'whatsapp_cloud' | 'whatsapp_evolution' | 'whatsapp_twilio';

  sendText(to: string, text: string): Promise<MessageId>;

  sendButtons(to: string, bodyText: string, buttons: InteractiveButton[]): Promise<MessageId>;

  sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
  ): Promise<MessageId>;

  sendTemplate(to: string, name: string, params: TemplateParams): Promise<MessageId>;

  sendMedia(
    to: string,
    kind: SendMediaKind,
    mediaUrl: string,
    options?: { caption?: string; filename?: string },
  ): Promise<MessageId>;

  downloadMedia(mediaId: string): Promise<MediaResult>;

  sendTyping(to: string, durationMs?: number): Promise<void>;
}

/** Error tipado para que el caller pueda hacer retry/escalation con criterio. */
export class WhatsAppConnectorError extends Error {
  public readonly code: string;
  public readonly status: number | undefined;
  public readonly retryable: boolean;

  constructor(message: string, code: string, status?: number, retryable = false, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'WhatsAppConnectorError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound (parsed webhook payload normalizado)
// ─────────────────────────────────────────────────────────────────────────────

export type InboundMessageType =
  | 'TEXT'
  | 'AUDIO'
  | 'IMAGE'
  | 'PDF'
  | 'VIDEO'
  | 'STICKER'
  | 'LOCATION'
  | 'CONTACT'
  | 'INTERACTIVE'
  | 'SYSTEM';

export interface NormalizedInboundMessage {
  tenantId: string;
  providerMessageId: string;
  fromPhoneE164: string;
  channel: 'WHATSAPP_CLOUD' | 'WHATSAPP_EVOLUTION' | 'WHATSAPP_TWILIO';
  type: InboundMessageType;
  text: string | null;
  mediaId: string | null;
  mediaMimeType: string | null;
  contactName: string | null;
  timestamp: Date;
  raw: unknown;
}
