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
  key?: { id: string; remoteJid?: string; fromMe?: boolean };
  message?: unknown;
  messageTimestamp?: number | string;
  status?: string;
}

interface EvolutionBase64Response {
  base64: string;
  mimetype?: string;
}

interface EvolutionConnectionStateResponse {
  instance?: { instanceName?: string; state?: string };
  state?: string;
}

interface EvolutionConnectQrResponse {
  pairingCode?: string | null;
  code?: string | null;
  base64?: string | null;
  count?: number | null;
  instance?: { state?: string };
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
 * Driver para Evolution API self-hosted (Baileys) — protocolo v2.
 * Docs: https://doc.evolution-api.com/v2
 *
 * Limitaciones conocidas (vs Meta Cloud):
 *  - No hay templates Meta-aprobados (no es API oficial)
 *  - Botones/listas dependen de la versión de Baileys que use Evolution
 *  - Riesgo de baneo del número por parte de Meta — solo para piloto
 */
export class EvolutionConnector implements WhatsAppConnector {
  readonly channel = 'whatsapp_evolution' as const;
  private readonly baseUrl: string;

  constructor(private readonly opts: EvolutionConnectorOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  // ── Mensajes salientes ─────────────────────────────────────────────────────

  async sendText(to: string, text: string): Promise<MessageId> {
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendText/${encodeURIComponent(this.opts.instanceName)}`,
      { number: stripPlus(to), text },
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
    // v2 espera: buttons: [{ title: 'reply'|'url'|'call', displayText, id }]
    // `title: 'reply'` es el tipo de botón (no el texto visible).
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendButtons/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: stripPlus(to),
        title: '',
        description: bodyText,
        footer: '',
        buttons: buttons.map((b) => ({
          title: 'reply',
          displayText: b.title,
          id: b.id,
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
    // v2: las secciones van en `values` (no `sections`).
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendList/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: stripPlus(to),
        title: '',
        description: bodyText,
        buttonText,
        footerText: '',
        values: sections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({
            title: r.title,
            description: r.description ?? '',
            rowId: r.id,
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
    options?: { caption?: string; filename?: string; mimeType?: string },
  ): Promise<MessageId> {
    if (kind === 'audio') {
      const json = await this.post<EvolutionSendResponse>(
        `/message/sendWhatsAppAudio/${encodeURIComponent(this.opts.instanceName)}`,
        { number: stripPlus(to), audio: mediaUrl },
        'SEND_MEDIA_FAILED',
      );
      return this.toMessageId(json);
    }
    const mediatype = kind === 'sticker' ? 'image' : kind;
    // v2 marca `mimetype` como required en sendMedia. Si no lo pasan, inferimos
    // por el `kind` (genérico, suficiente para que Baileys no rechace el envío).
    const mimetype = options?.mimeType ?? defaultMimeForKind(kind);
    const json = await this.post<EvolutionSendResponse>(
      `/message/sendMedia/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: stripPlus(to),
        mediatype,
        mimetype,
        media: mediaUrl,
        caption: options?.caption ?? '',
        fileName: options?.filename ?? defaultFilenameForKind(kind, mimetype),
      },
      'SEND_MEDIA_FAILED',
    );
    return this.toMessageId(json);
  }

  async sendTyping(to: string, durationMs = 1500): Promise<void> {
    // v2: { number, options: { presence: 'composing'|'recording', delay } }
    await this.post<unknown>(
      `/chat/sendPresence/${encodeURIComponent(this.opts.instanceName)}`,
      {
        number: stripPlus(to),
        options: { presence: 'composing', delay: durationMs },
      },
      'SEND_TYPING_FAILED',
    ).catch(() => {
      // No fallamos el flujo por un typing indicator.
    });
  }

  /**
   * Obtiene la URL de la foto de perfil de un contacto de WhatsApp.
   * Evolution endpoint: POST /chat/fetchProfilePictureUrl/{instance} con
   * body { number: '<E.164 sin +>' }. Devuelve null si:
   *   - El contacto tiene el privacy setting "Nadie" para foto de perfil.
   *   - El endpoint responde 404 / sin profilePictureUrl.
   *   - Algún error de red.
   * Esto es estrictamente best-effort.
   */
  async fetchProfilePictureUrl(toE164: string): Promise<string | null> {
    try {
      const json = await this.post<{ wuid?: string; profilePictureUrl?: string | null }>(
        `/chat/fetchProfilePictureUrl/${encodeURIComponent(this.opts.instanceName)}`,
        { number: stripPlus(toE164) },
        'FETCH_PROFILE_PIC_FAILED',
      );
      return json.profilePictureUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Marca uno o varios mensajes inbound como leídos. Best-effort. */
  async markAsRead(
    items: Array<{ remoteJid: string; fromMe: boolean; id: string }>,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.post<unknown>(
      `/chat/markMessageAsRead/${encodeURIComponent(this.opts.instanceName)}`,
      { readMessages: items },
      'MARK_AS_READ_FAILED',
    ).catch(() => {
      // No fallamos el flujo por un read receipt.
    });
  }

  // ── Multimedia inbound ─────────────────────────────────────────────────────

  async downloadMedia(
    mediaId: string,
    context?: { remoteJid?: string; fromMe?: boolean },
  ): Promise<MediaResult> {
    // v2 acepta `{ message: { key: { id, [remoteJid], [fromMe] } } }`.
    // Mandamos los campos opcionales cuando los tenemos para que Evolution
    // pueda resolver el chat exacto en caso de duplicados de id.
    const key: { id: string; remoteJid?: string; fromMe?: boolean } = { id: mediaId };
    if (context?.remoteJid) key.remoteJid = context.remoteJid;
    if (typeof context?.fromMe === 'boolean') key.fromMe = context.fromMe;
    const json = await this.post<EvolutionBase64Response>(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(this.opts.instanceName)}`,
      { message: { key }, convertToMp4: false },
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

  // ── Instance lifecycle (usado por server actions) ──────────────────────────

  /**
   * Devuelve el estado actual de conexión de la instancia.
   * Estados Baileys: open | close | connecting.
   */
  async getConnectionState(): Promise<{ state: string }> {
    const json = await this.getJson<EvolutionConnectionStateResponse>(
      `/instance/connectionState/${encodeURIComponent(this.opts.instanceName)}`,
      'CONNECTION_STATE_FAILED',
    );
    const state = json.instance?.state ?? json.state ?? 'close';
    return { state };
  }

  /**
   * Re-emite el QR (o pairing code) para una instancia ya creada que aún no
   * está vinculada. Útil cuando el QR caducó. Devuelve la imagen base64 si
   * Evolution la generó.
   */
  async requestNewQrCode(): Promise<EvolutionConnectQrResponse> {
    return this.getJson<EvolutionConnectQrResponse>(
      `/instance/connect/${encodeURIComponent(this.opts.instanceName)}`,
      'INSTANCE_CONNECT_FAILED',
    );
  }

  /** Cierra la sesión WhatsApp en el servidor Evolution. */
  async logout(): Promise<void> {
    await this.del<unknown>(
      `/instance/logout/${encodeURIComponent(this.opts.instanceName)}`,
      'INSTANCE_LOGOUT_FAILED',
    ).catch(() => {
      // best-effort; el caller ya marcó DISCONNECTED en BD.
    });
  }

  /** Borra completamente la instancia del servidor Evolution. */
  async deleteInstance(): Promise<void> {
    await this.del<unknown>(
      `/instance/delete/${encodeURIComponent(this.opts.instanceName)}`,
      'INSTANCE_DELETE_FAILED',
    ).catch(() => {
      // best-effort.
    });
  }

  /**
   * Configura Chatwoot a nivel de instancia. Cuando está activo Evolution
   * actúa como bridge: cada mensaje inbound se reenvía a Chatwoot y los
   * agentes responden desde Chatwoot. Nuestra app sigue recibiendo el
   * webhook MESSAGES_UPSERT en paralelo (así el inbox propio sigue vivo).
   */
  async setChatwoot(input: {
    url: string;
    accountId: string;
    token: string;
    nameInbox?: string;
    signMsg?: boolean;
    reopenConversation?: boolean;
    conversationPending?: boolean;
    importContacts?: boolean;
    importMessages?: boolean;
    mergeBrazilContacts?: boolean;
    daysLimitImportMessages?: number;
    organization?: string;
    logo?: string;
    enabled?: boolean;
  }): Promise<unknown> {
    return this.post<unknown>(
      `/chatwoot/set/${encodeURIComponent(this.opts.instanceName)}`,
      {
        enabled: input.enabled ?? true,
        accountId: input.accountId,
        token: input.token,
        url: input.url.replace(/\/$/, ''),
        signMsg: input.signMsg ?? false,
        reopenConversation: input.reopenConversation ?? true,
        conversationPending: input.conversationPending ?? false,
        nameInbox: input.nameInbox ?? this.opts.instanceName,
        importContacts: input.importContacts ?? false,
        importMessages: input.importMessages ?? false,
        mergeBrazilContacts: input.mergeBrazilContacts ?? false,
        daysLimitImportMessages: input.daysLimitImportMessages ?? 7,
        organization: input.organization ?? 'Cliniq',
        logo: input.logo ?? '',
      },
      'CHATWOOT_SET_FAILED',
    );
  }

  // ── HTTP plumbing ──────────────────────────────────────────────────────────

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

  private async getJson<T>(path: string, code: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { apikey: this.opts.apiKey },
    });
    if (!res.ok) {
      throw await this.toError(res, code);
    }
    return (await res.json()) as T;
  }

  private async del<T>(path: string, code: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { apikey: this.opts.apiKey },
    });
    if (!res.ok) {
      throw await this.toError(res, code);
    }
    // Algunos endpoints de delete devuelven 200 sin body parseable.
    try {
      return (await res.json()) as T;
    } catch {
      return {} as T;
    }
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

// Evolution acepta `+34...` o `34...`. Para evitar variantes, normalizamos a
// el formato sin `+` que es el que la doc usa en los ejemplos.
function stripPlus(phone: string): string {
  return phone.trim().replace(/^\+/, '');
}

function defaultMimeForKind(kind: SendMediaKind): string {
  switch (kind) {
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'document':
      return 'application/pdf';
    case 'sticker':
      return 'image/webp';
    case 'audio':
      return 'audio/ogg';
  }
}

function defaultFilenameForKind(kind: SendMediaKind, mime: string): string {
  const ext = mime.split('/')[1] ?? 'bin';
  return `${kind}.${ext}`;
}
