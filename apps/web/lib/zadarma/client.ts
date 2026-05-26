import 'server-only';
import { buildZadarmaSignature, buildSortedParamsString } from './signing';

/**
 * Cliente REST de Zadarma acotado a las operaciones que necesitamos para el
 * setup multi-tenant:
 *   - ping (info/balance) → validación de credenciales.
 *   - listDirectNumbers (direct_numbers) → DIDs que el tenant tiene comprados
 *     en Zadarma. Equivalen a los IncomingPhoneNumbers de Twilio.
 *   - listOutgoingCallerIds (numbers/caller-id) → caller IDs verificados en
 *     el cabinet. Zadarma NO tiene API para iniciar verificación por DTMF
 *     (eso se hace en el cabinet via SMS/llamada); sólo listamos los ya
 *     verificados.
 *   - createCallback (request/callback) → dispara una llamada saliente. Es
 *     el equivalente a `retell.call.createPhoneCall` cuando el provider es
 *     Zadarma (sin Retell BYOT — Retell sólo soporta Twilio BYOT nativo).
 *   - setNotificationUrl (webhook/notification) → registra la URL que recibe
 *     los eventos NOTIFY_*. Equivalente a Twilio.IncomingPhoneNumber.VoiceUrl.
 *
 * Auth: HMAC-SHA1 sobre method + sorted_params + md5(sorted_params), tomado
 * en hex y base64-encoded. Ver lib/zadarma/signing.ts.
 *
 * No usamos el SDK oficial porque:
 *   - No hay SDK oficial en Node.
 *   - Sólo usamos ~5 endpoints; un wrapper fetch es trivial y testeable.
 */

const BASE_URL = 'https://api.zadarma.com';

export class ZadarmaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number | string,
  ) {
    super(message);
    this.name = 'ZadarmaApiError';
  }
}

export interface ZadarmaClientOptions {
  /** "User key" del API (visible en cabinet → API). */
  userKey: string;
  /** "Secret" del API. */
  secret: string;
  /** Sólo para tests. */
  baseUrl?: string;
}

/**
 * Estructura genérica de respuesta Zadarma. Todas envuelven los datos en
 * `{ status: 'success' | 'error', message?, ... }`. Los campos data van en
 * la raíz del objeto, distintos según el endpoint.
 */
interface ZadarmaEnvelope<T> {
  status: 'success' | 'error';
  message?: string;
  code?: number | string;
  // Cada endpoint mete sus campos en la raíz; T captura el shape esperado.
  data?: T;
  [key: string]: unknown;
}

export interface ZadarmaBalance {
  balance: number;
  currency: string; // 'USD' | 'EUR' | ...
}

export interface ZadarmaDirectNumber {
  number: string; // E.164 sin "+"  (ej. "34911234567")
  type: string; // "direct" | "mobile" | ...
  country: string;
  status: string; // "active" | ...
  description?: string;
  /** Fecha de expiración del DID, ISO. */
  expired?: string;
}

export interface ZadarmaVerifiedCallerId {
  /** El número en formato internacional sin "+". */
  number: string;
  status: 'verified' | 'pending' | string;
}

export interface ZadarmaCallbackResponse {
  /** ID interno de la llamada (Zadarma asigna). */
  pbx_call_id?: string;
  from?: string;
  to?: string;
  time?: string;
}

export class ZadarmaRestClient {
  private readonly userKey: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(opts: ZadarmaClientOptions) {
    this.userKey = opts.userKey;
    this.secret = opts.secret;
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/$/, '');
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  /**
   * Verifica que las credenciales sean válidas haciendo un GET liviano a
   * /v1/info/balance/. Devuelve true en éxito, false si Zadarma responde 401.
   * Otros errores se propagan.
   */
  async ping(): Promise<boolean> {
    const res = await this.request('GET', '/v1/info/balance/', {});
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<unknown>;
    return body.status === 'success';
  }

  async getBalance(): Promise<ZadarmaBalance> {
    const res = await this.request('GET', '/v1/info/balance/', {});
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<unknown> & {
      balance?: number;
      currency?: string;
    };
    if (body.status !== 'success' || body.balance == null) {
      throw new ZadarmaApiError(body.message ?? 'Zadarma balance no disponible', 502, body.code);
    }
    return { balance: body.balance, currency: body.currency ?? 'USD' };
  }

  // ─── Números (DIDs comprados al provider) ──────────────────────────────────

  /**
   * Lista los DIDs comprados por la cuenta. Equivalente a Twilio
   * IncomingPhoneNumbers.
   */
  async listDirectNumbers(): Promise<ZadarmaDirectNumber[]> {
    const res = await this.request('GET', '/v1/direct_numbers/', {});
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<ZadarmaDirectNumber[]> & {
      info?: ZadarmaDirectNumber[];
      numbers?: ZadarmaDirectNumber[];
    };
    if (body.status !== 'success') {
      throw new ZadarmaApiError(body.message ?? 'direct_numbers error', 502, body.code);
    }
    // Zadarma a veces usa `info`, a veces `numbers` según versión del endpoint.
    return body.info ?? body.numbers ?? [];
  }

  // ─── Caller IDs verificados ────────────────────────────────────────────────

  /**
   * Lista caller IDs verificados (números personales del usuario que pueden
   * usarse como "from" en llamadas salientes). Zadarma NO ofrece API para
   * iniciar la verificación; eso se hace en cabinet.zadarma.com → My numbers.
   * Acá sólo listamos los ya verificados.
   *
   * Si el endpoint no está disponible para la cuenta (algunas regiones),
   * devolvemos array vacío en vez de tirar.
   */
  async listVerifiedCallerIds(): Promise<ZadarmaVerifiedCallerId[]> {
    const res = await this.request('GET', '/v1/numbers/caller-id/', {});
    if (res.status === 404) return [];
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<ZadarmaVerifiedCallerId[]> & {
      numbers?: ZadarmaVerifiedCallerId[];
      caller_id?: ZadarmaVerifiedCallerId[];
    };
    if (body.status !== 'success') return [];
    return body.numbers ?? body.caller_id ?? [];
  }

  // ─── Outbound (callback API) ───────────────────────────────────────────────

  /**
   * Dispara una llamada saliente Zadarma usando "Callback":
   *   1. Zadarma llama primero al número `from` (o al SIP interno si se pasa).
   *   2. Cuando atiende, Zadarma llama a `to` y conecta ambos.
   *
   * Para un flow de agente AI (Retell), `from` debería ser un SIP/extensión
   * interno mapeado al SIP trunk de Retell (configurable en cabinet); para un
   * callback humano-a-humano, `from` es el teléfono del operador y `to` el
   * destino.
   *
   * Endpoint: GET /v1/request/callback/?from=&to=&sip=&predicted=
   */
  async createCallback(args: {
    from: string;
    to: string;
    /** SIP interno a usar como leg A (opcional). */
    sip?: string;
    /** Modo "predictive" (Zadarma llama primero al destino). */
    predicted?: boolean;
  }): Promise<ZadarmaCallbackResponse> {
    const params: Record<string, string> = {
      from: args.from,
      to: args.to,
    };
    if (args.sip) params.sip = args.sip;
    if (args.predicted) params.predicted = 'true';

    const res = await this.request('GET', '/v1/request/callback/', params);
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<unknown> & ZadarmaCallbackResponse;
    if (body.status !== 'success') {
      throw new ZadarmaApiError(body.message ?? 'callback error', 502, body.code);
    }
    return {
      pbx_call_id: body.pbx_call_id,
      from: body.from,
      to: body.to,
      time: body.time,
    };
  }

  // ─── Webhook (NOTIFY_* events) ─────────────────────────────────────────────

  /**
   * Registra la URL que recibe los eventos NOTIFY_* (llamadas entrantes,
   * salientes, IVR, etc.). Sustituye al campo VoiceUrl/SmsUrl de Twilio
   * IncomingPhoneNumber pero a nivel cuenta (no por número).
   *
   * Endpoint: POST /v1/webhook/ con param webhook_url.
   * (El path /v1/webhook/notification/ que aparecía antes en los docs de
   * Zadarma fue retirado — devuelve "Wrong method name".)
   *
   * Importante: Zadarma sólo permite un único webhook por cuenta. Eso
   * significa que para multi-tenant necesitamos una cuenta Zadarma por
   * tenant (igual que Twilio: una subaccount por clínica).
   */
  async setNotificationUrl(webhookUrl: string): Promise<void> {
    const res = await this.request('POST', '/v1/webhook/', {
      webhook_url: webhookUrl,
    });
    if (!res.ok) throw await this.toError(res);
    const body = (await res.json()) as ZadarmaEnvelope<unknown>;
    if (body.status !== 'success') {
      throw new ZadarmaApiError(body.message ?? 'set_webhook error', 502, body.code);
    }
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async request(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number | boolean | undefined | null>,
  ): Promise<Response> {
    const { authorization, paramsString } = buildZadarmaSignature(
      path,
      params,
      this.userKey,
      this.secret,
    );

    // GET ⇒ params en query string. POST ⇒ params en body (form-urlencoded).
    // Zadarma acepta ambos; usamos GET para reads y POST para writes.
    const url =
      method === 'GET' && paramsString
        ? `${this.baseUrl}${path}?${paramsString}`
        : `${this.baseUrl}${path}`;

    return fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(method === 'POST' && paramsString
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
      },
      body: method === 'POST' && paramsString ? paramsString : undefined,
    });
  }

  private async toError(res: Response): Promise<ZadarmaApiError> {
    let payload: { message?: string; code?: number | string } | undefined;
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    return new ZadarmaApiError(
      payload?.message ?? `Zadarma ${res.status} ${res.statusText}`,
      res.status,
      payload?.code,
    );
  }
}

/** Helper para uso recurrente. */
export function newZadarmaClient(userKey: string, secret: string): ZadarmaRestClient {
  return new ZadarmaRestClient({ userKey, secret });
}

/**
 * Re-export para testing convenience.
 * @internal
 */
export { buildSortedParamsString };
