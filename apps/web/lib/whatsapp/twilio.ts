import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { TokenBucket } from './rate-limit';
import {
  type InteractiveButton,
  type ListSection,
  type MediaResult,
  type MessageId,
  type SendMediaKind,
  type TemplateParams,
  type WhatsAppConnector,
  WhatsAppConnectorError,
} from './types';

interface TwilioMessageResponse {
  sid?: string;
  status?: string;
  error_code?: number | null;
  error_message?: string | null;
}

export interface TwilioConnectorOptions {
  /** Account SID de Twilio (empieza por "AC..."). */
  accountSid: string;
  /** Auth Token de Twilio (cifrado en BD). */
  authToken: string;
  /** Número remitente E.164 (ej: "+34123456789"). Se le antepone "whatsapp:" al enviar. */
  fromNumber: string;
  /** Override para tests. Default: https://api.twilio.com */
  baseUrl?: string;
  /** Override del path de versión. Default: 2010-04-01. */
  apiVersion?: string;
  /** Rate limit por sender (Twilio default tier: ~1 msg/seg; subir según plan). */
  messagesPerSecond?: number;
}

/**
 * Driver para Twilio Programmable Messaging (canal WhatsApp).
 * Docs: https://www.twilio.com/docs/whatsapp/api
 *
 * Limitaciones vs Meta Cloud:
 *  - Interactivos (button reply / list) requieren plantillas de Content API; no
 *    soportadas en este driver todavía — se lanza NOT_SUPPORTED.
 *  - `sendTemplate` requiere un Content SID pre-aprobado en Twilio; el contrato
 *    actual del interface es por nombre de plantilla → tampoco soportado.
 *  - `sendTyping` no existe en Twilio → no-op.
 */
export class TwilioConnector implements WhatsAppConnector {
  readonly channel = 'whatsapp_twilio' as const;
  private readonly bucket: TokenBucket;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly authHeader: string;

  constructor(private readonly opts: TwilioConnectorOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.twilio.com').replace(/\/$/, '');
    this.apiVersion = opts.apiVersion ?? '2010-04-01';
    const rps = opts.messagesPerSecond ?? 1;
    this.bucket = new TokenBucket(rps, rps);
    this.authHeader = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`;
  }

  async sendText(to: string, text: string): Promise<MessageId> {
    return this.sendMessage({ To: toWhatsapp(to), Body: text });
  }

  async sendButtons(
    _to: string,
    _bodyText: string,
    _buttons: InteractiveButton[],
  ): Promise<MessageId> {
    throw new WhatsAppConnectorError(
      'Twilio WhatsApp no soporta botones interactivos sin Content API templates',
      'NOT_SUPPORTED',
      undefined,
      false,
    );
  }

  async sendList(
    _to: string,
    _bodyText: string,
    _buttonText: string,
    _sections: ListSection[],
  ): Promise<MessageId> {
    throw new WhatsAppConnectorError(
      'Twilio WhatsApp no soporta listas interactivas sin Content API templates',
      'NOT_SUPPORTED',
      undefined,
      false,
    );
  }

  async sendTemplate(_to: string, _name: string, _params: TemplateParams): Promise<MessageId> {
    // Para templates de Twilio se requiere un Content SID, no nombre. El
    // contrato actual no lo provee, así que dejamos esto como no soportado.
    // Si en el futuro queremos soportarlo, hace falta extender el interface
    // con un parámetro opcional `contentSid`.
    throw new WhatsAppConnectorError(
      'Twilio templates requieren Content SID — usa sendText o extiende el driver',
      'NOT_SUPPORTED',
      undefined,
      false,
    );
  }

  async sendMedia(
    to: string,
    _kind: SendMediaKind,
    mediaUrl: string,
    options?: { caption?: string; filename?: string },
  ): Promise<MessageId> {
    const params: Record<string, string> = {
      To: toWhatsapp(to),
      MediaUrl: mediaUrl,
    };
    if (options?.caption) params.Body = options.caption;
    return this.sendMessage(params);
  }

  async sendTyping(_to: string, _durationMs?: number): Promise<void> {
    // Twilio no expone "typing..." en WhatsApp. No-op intencional.
    return;
  }

  /**
   * Twilio entrega assets como URLs autenticadas. El consumidor descarga con
   * Basic auth sobre el SID/Token de la cuenta. `mediaId` aquí es la URL
   * completa (la guardamos así en el normalizador inbound).
   */
  async downloadMedia(mediaId: string): Promise<MediaResult> {
    const res = await fetch(mediaId, {
      headers: { Authorization: this.authHeader },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw await this.toError(res, 'MEDIA_DOWNLOAD_FAILED');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
    return { buffer: buf, mimeType, sizeBytes: buf.length };
  }

  /**
   * Verifica `X-Twilio-Signature`. Algoritmo Twilio:
   *  - signedString = fullUrl + concat(sortedKeys.map(k => k + value[k]))
   *  - expected     = base64(HMAC-SHA1(authToken, signedString))
   *
   * `fullUrl` debe coincidir exactamente con la URL configurada en Twilio (sin
   * normalizar trailing slash). Si la URL tiene query-string, debe incluirse.
   */
  verifyWebhookSignature(
    fullUrl: string,
    params: Record<string, string>,
    headerValue: string,
  ): boolean {
    const keys = Object.keys(params).sort();
    let signedString = fullUrl;
    for (const k of keys) {
      signedString += k + params[k];
    }
    const computed = createHmac('sha1', this.opts.authToken).update(signedString).digest('base64');
    if (computed.length !== headerValue.length) return false;
    return timingSafeEqual(Buffer.from(computed, 'utf8'), Buffer.from(headerValue, 'utf8'));
  }

  private async sendMessage(params: Record<string, string>): Promise<MessageId> {
    await this.bucket.take();
    const body = new URLSearchParams({
      From: toWhatsapp(this.opts.fromNumber),
      ...params,
    });
    const url = `${this.baseUrl}/${this.apiVersion}/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      throw await this.toError(res, 'SEND_FAILED');
    }
    const json = (await res.json()) as TwilioMessageResponse;
    if (!json.sid) {
      throw new WhatsAppConnectorError(
        `Respuesta Twilio sin sid: ${JSON.stringify(json).slice(0, 200)}`,
        'INVALID_RESPONSE',
        res.status,
        false,
      );
    }
    if (json.error_code) {
      throw new WhatsAppConnectorError(
        `Twilio error ${json.error_code}: ${json.error_message ?? 'unknown'}`,
        'TWILIO_ERROR',
        res.status,
        false,
      );
    }
    return { id: json.sid, channel: this.channel };
  }

  private async toError(res: Response, code: string): Promise<WhatsAppConnectorError> {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    const retryable = res.status === 429 || res.status >= 500;
    return new WhatsAppConnectorError(
      `Twilio ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
      code,
      res.status,
      retryable,
    );
  }
}

function toWhatsapp(e164: string): string {
  const trimmed = e164.trim();
  if (trimmed.startsWith('whatsapp:')) return trimmed;
  const withPlus = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  return `whatsapp:${withPlus}`;
}
