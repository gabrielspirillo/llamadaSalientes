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

interface GraphSendResponse {
  messaging_product: 'whatsapp';
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

interface GraphMediaInfoResponse {
  url: string;
  mime_type: string;
  file_size?: number;
  id: string;
}

export interface WhatsAppCloudConnectorOptions {
  /** Phone Number ID de WABA (no el número de teléfono visible). */
  phoneNumberId: string;
  /** Bearer token con permisos messaging_messages_send y whatsapp_business_messaging. */
  accessToken: string;
  /** App secret para verificar firmas inbound (HMAC-SHA256 del raw body). */
  appSecret: string;
  /** Override para tests. Default: WHATSAPP_GRAPH_API_VERSION env o "v21.0". */
  apiVersion?: string;
  /** Override para tests / proxies. Default: https://graph.facebook.com */
  baseUrl?: string;
  /** Rate limit por phone number (Meta default: 80 msg/seg). */
  messagesPerSecond?: number;
}

/**
 * Driver oficial Meta Cloud API.
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */
export class WhatsAppCloudConnector implements WhatsAppConnector {
  readonly channel = 'whatsapp_cloud' as const;
  private readonly bucket: TokenBucket;
  private readonly baseUrl: string;
  private readonly apiVersion: string;

  constructor(private readonly opts: WhatsAppCloudConnectorOptions) {
    this.apiVersion = opts.apiVersion ?? process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v21.0';
    this.baseUrl = (opts.baseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '');
    const rps = opts.messagesPerSecond ?? 80;
    this.bucket = new TokenBucket(rps, rps);
  }

  async sendText(to: string, text: string): Promise<MessageId> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text, preview_url: false },
    });
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: InteractiveButton[],
  ): Promise<MessageId> {
    if (buttons.length === 0 || buttons.length > 3) {
      throw new WhatsAppConnectorError(
        `Cloud API permite 1-3 botones, recibido ${buttons.length}`,
        'INVALID_BUTTON_COUNT',
        undefined,
        false,
      );
    }
    for (const b of buttons) {
      if (b.title.length > 20) {
        throw new WhatsAppConnectorError(
          `Botón "${b.title}" excede 20 chars`,
          'INVALID_BUTTON_TITLE',
          undefined,
          false,
        );
      }
    }
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.title },
          })),
        },
      },
    });
  }

  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
  ): Promise<MessageId> {
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map((s) => ({
            title: s.title,
            rows: s.rows.map((r) => ({
              id: r.id,
              title: r.title,
              ...(r.description ? { description: r.description } : {}),
            })),
          })),
        },
      },
    });
  }

  async sendTemplate(to: string, name: string, params: TemplateParams): Promise<MessageId> {
    const components: unknown[] = [];
    if (params.header && params.header.length > 0) {
      components.push({
        type: 'header',
        parameters: params.header.map((p) => this.toGraphParam(p)),
      });
    }
    if (params.body && params.body.length > 0) {
      components.push({
        type: 'body',
        parameters: params.body.map((p) => this.toGraphParam(p)),
      });
    }
    if (params.buttons) {
      params.buttons.forEach((b, idx) => {
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index: idx,
          parameters: b.map((p) => this.toGraphParam(p)),
        });
      });
    }
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name,
        language: { code: params.language },
        ...(components.length > 0 ? { components } : {}),
      },
    });
  }

  async sendMedia(
    to: string,
    kind: SendMediaKind,
    mediaUrl: string,
    options?: { caption?: string; filename?: string },
  ): Promise<MessageId> {
    const mediaPayload: Record<string, unknown> = { link: mediaUrl };
    if (options?.caption) mediaPayload.caption = options.caption;
    if (options?.filename && kind === 'document') mediaPayload.filename = options.filename;
    return this.send({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: kind,
      [kind]: mediaPayload,
    });
  }

  async sendTyping(_to: string, _durationMs?: number): Promise<void> {
    // Cloud API no expone API pública para "typing..." outbound. No-op intencional.
    return;
  }

  async downloadMedia(mediaId: string): Promise<MediaResult> {
    const infoUrl = `${this.baseUrl}/${this.apiVersion}/${encodeURIComponent(mediaId)}`;
    const infoRes = await fetch(infoUrl, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!infoRes.ok) {
      throw await this.toError(infoRes, 'MEDIA_INFO_FAILED');
    }
    const info = (await infoRes.json()) as GraphMediaInfoResponse;

    const mediaRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${this.opts.accessToken}` },
    });
    if (!mediaRes.ok) {
      throw await this.toError(mediaRes, 'MEDIA_DOWNLOAD_FAILED');
    }
    const buf = Buffer.from(await mediaRes.arrayBuffer());
    return { buffer: buf, mimeType: info.mime_type, sizeBytes: info.file_size };
  }

  /**
   * Verifica el header `X-Hub-Signature-256` que Meta agrega a cada webhook.
   * Formato: "sha256=<hex>". HMAC-SHA256 sobre el raw body, key = appSecret.
   */
  verifyWebhookSignature(rawBody: string | Buffer, headerValue: string): boolean {
    if (!headerValue.startsWith('sha256=')) return false;
    const expected = headerValue.slice('sha256='.length);
    const computed = createHmac('sha256', this.opts.appSecret).update(rawBody).digest('hex');
    if (expected.length !== computed.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(computed, 'utf8'));
  }

  private async send(payload: Record<string, unknown>): Promise<MessageId> {
    await this.bucket.take();
    const url = `${this.baseUrl}/${this.apiVersion}/${encodeURIComponent(this.opts.phoneNumberId)}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw await this.toError(res, 'SEND_FAILED');
    }
    const json = (await res.json()) as GraphSendResponse;
    const id = json.messages?.[0]?.id;
    if (!id) {
      throw new WhatsAppConnectorError(
        'Respuesta sin messages[0].id',
        'INVALID_RESPONSE',
        res.status,
        false,
      );
    }
    return { id, channel: this.channel };
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
      `Cloud API ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
      code,
      res.status,
      retryable,
    );
  }

  private toGraphParam(p: { type: 'text' | 'currency' | 'date_time'; value: string }): unknown {
    if (p.type === 'text') return { type: 'text', text: p.value };
    if (p.type === 'currency') {
      const [code, amount] = p.value.split(':');
      return {
        type: 'currency',
        currency: { code: code ?? 'EUR', amount_1000: Number(amount ?? '0') },
      };
    }
    return { type: 'date_time', date_time: { fallback_value: p.value } };
  }
}
