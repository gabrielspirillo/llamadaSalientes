import { Buffer } from 'node:buffer';

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

interface EvolutionSendResponse {
  key?: { id: string; remoteJid?: string };
  message?: unknown;
}

interface EvolutionBase64Response {
  base64: string;
  mimetype?: string;
}

export interface EvolutionConnectorOptions {
  /** Base URL del servidor Evolution, ej: http://evolution.local:8080 */
  baseUrl: string;
  /** Nombre de la instancia (1:1 con tenant). */
  instanceName: string;
  /** Hash/api key devuelto al crear la instancia. Header `apikey`. */
  apiKey: string;
}

/**
 * Driver para Evolution API self-hosted (Baileys).
 * Docs: https://doc.evolution-api.com/
 *
 * Limitaciones conocidas (vs Cloud):
 *  - Templates aprobados de Meta no aplican (no es API oficial)
 *  - Botones/listas dependen de la versión de Baileys que use Evolution
 *  - Riesgo de baneo del número por parte de Meta — uso recomendado solo para piloto
 */
export class EvolutionConnector implements WhatsAppConnector {
  readonly channel = 'whatsapp_evolution' as const;
  private readonly baseUrl: string;

  constructor(private readonly opts: EvolutionConnectorOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  async sendText(to: string, text: string): Promise<MessageId> {
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendText/${encodeURIComponent(this.opts.instanceName)}`,
      { number: to, text },
      'SEND_TEXT_FAILED',
    );
    return this.toMessageId(json);
  }

  async sendButtons(
    to: string,
    bodyText: string,
    buttons: InteractiveButton[],
  ): Promise<MessageId> {
    if (buttons.length === 0 || buttons.length > 3) {
      throw new WhatsAppConnectorError(
        `Evolution buttons: 1-3 esperado, recibido ${buttons.length}`,
        'INVALID_BUTTON_COUNT',
        undefined,
        false,
      );
    }
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendButtons/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: to,
        title: '',
        description: bodyText,
        footer: '',
        buttons: buttons.map((b) => ({
          buttonId: b.id,
          buttonText: { displayText: b.title },
          type: 1,
        })),
      },
      'SEND_BUTTONS_FAILED',
    );
    return this.toMessageId(json);
  }

  async sendList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
  ): Promise<MessageId> {
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendList/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: to,
        title: '',
        description: bodyText,
        buttonText,
        footerText: '',
        sections: sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({
            rowId: r.id,
            title: r.title,
            description: r.description ?? '',
          })),
        })),
      },
      'SEND_LIST_FAILED',
    );
    return this.toMessageId(json);
  }

  /**
   * Evolution no soporta templates Meta-aprobados. Mapeamos a sendText para
   * mantener la firma compatible. Mejor evitar la ruta de templates en este driver.
   */
  async sendTemplate(to: string, name: string, params: TemplateParams): Promise<MessageId> {
    const body = (params.body ?? []).map((p) => p.value).join(' ');
    const text = `[${name}] ${body}`.trim();
    return this.sendText(to, text);
  }

  async sendMedia(
    to: string,
    kind: SendMediaKind,
    mediaUrl: string,
    options?: { caption?: string; filename?: string },
  ): Promise<MessageId> {
    const mediatype = kind === 'sticker' ? 'image' : kind;
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendMedia/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: to,
        mediatype,
        media: mediaUrl,
        caption: options?.caption,
        fileName: options?.filename,
      },
      'SEND_MEDIA_FAILED',
    );
    return this.toMessageId(json);
  }

  async sendTyping(to: string, durationMs = 1500): Promise<void> {
    await this.post<unknown>(
      `/chat/sendPresence/${encodeURIComponent(this.opts.instanceName)}`,
      { number: to, presence: 'composing', delay: durationMs },
      'SEND_TYPING_FAILED',
    ).catch(() => {
      // No fallamos el flujo por un typing indicator.
    });
  }

  async downloadMedia(mediaId: string): Promise<MediaResult> {
    const json = await this.post<EvolutionBase64Response>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.opts.instanceName)}`,
      { message: { key: { id: mediaId } }, convertToMp4: false },
      'MEDIA_DOWNLOAD_FAILED',
    );
    if (!json.base64) {
      throw new WhatsAppConnectorError(
        'Respuesta sin base64',
        'INVALID_MEDIA_RESPONSE',
        undefined,
        false,
      );
    }
    const buffer = Buffer.from(json.base64, 'base64');
    return {
      buffer,
      mimeType: json.mimetype ?? 'application/octet-stream',
      sizeBytes: buffer.length,
    };
  }

  private async post<T>(path: string, body: unknown, code: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        apikey: this.opts.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await this.toError(res, code);
    }
    return (await res.json()) as T;
  }

  private toMessageId(json: EvolutionSendResponse): MessageId {
    const id = json.key?.id;
    if (!id) {
      throw new WhatsAppConnectorError(
        'Evolution respuesta sin key.id',
        'INVALID_RESPONSE',
        undefined,
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
      `Evolution API ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`,
      code,
      res.status,
      retryable,
    );
  }
}
