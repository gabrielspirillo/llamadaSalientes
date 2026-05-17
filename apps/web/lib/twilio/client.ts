import 'server-only';
import { Buffer } from 'node:buffer';

/**
 * Cliente Twilio REST acotado a las operaciones que necesitamos para la
 * configuración multi-tenant:
 *   - Verified Caller IDs (Outgoing Caller ID API): para que el `From` de
 *     una llamada saliente muestre el número público de la clínica.
 *   - Incoming Phone Numbers: para asignar un DID Twilio por tenant que
 *     reciba las llamadas desviadas desde la línea de la clínica y
 *     configurar su VoiceUrl / SmsUrl apuntando a nuestros webhooks.
 *
 * Por qué no usamos el SDK oficial `twilio`:
 *   - Pesa ~5 MB y arrastra deps incompatibles con edge runtime.
 *   - Solo usamos 4 endpoints; un wrapper fetch es trivial y testeable.
 *
 * Las credenciales (accountSid + authToken) llegan ya decifradas. La cifra
 * está en lib/crypto + tenant_telephony.twilio_auth_token_enc.
 */

const BASE_URL = 'https://api.twilio.com';
const API_VERSION = '2010-04-01';

export class TwilioApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'TwilioApiError';
  }
}

export interface TwilioClientOptions {
  accountSid: string;
  authToken: string;
  /** Sólo para tests. */
  baseUrl?: string;
}

export interface VerifiedCallerIdCreateResponse {
  /** Código que el usuario debe ingresar por DTMF cuando Twilio le llama. */
  validation_code: string;
  /** Twilio reusa este `call_sid` durante la verificación. */
  call_sid: string;
  account_sid: string;
  phone_number: string;
  friendly_name: string;
}

export interface VerifiedCallerIdResource {
  sid: string;
  account_sid: string;
  friendly_name: string;
  phone_number: string;
  date_created: string;
  date_updated: string;
}

export interface IncomingPhoneNumberResource {
  sid: string;
  account_sid: string;
  phone_number: string;
  friendly_name: string;
  voice_url: string | null;
  voice_method: string | null;
  sms_url: string | null;
  sms_method: string | null;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean };
}

export interface TwilioListResponse<T> {
  page: number;
  page_size: number;
  num_pages?: number;
  total?: number;
  first_page_uri?: string;
  next_page_uri?: string | null;
  end?: number;
  start?: number;
  uri?: string;
  /** Twilio resource key cambia por endpoint (incoming_phone_numbers, outgoing_caller_ids, ...) */
  [key: string]: unknown | T[];
}

export class TwilioRestClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly accountSid: string;

  constructor(opts: TwilioClientOptions) {
    this.accountSid = opts.accountSid;
    this.baseUrl = (opts.baseUrl ?? BASE_URL).replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`;
  }

  /**
   * Verifica que las credenciales sean válidas haciendo un GET liviano al
   * recurso Account. Devuelve true si Twilio responde 200, false si 401.
   * Cualquier otro error se propaga.
   */
  async ping(): Promise<boolean> {
    const res = await this.request('GET', `Accounts/${encodeURIComponent(this.accountSid)}.json`);
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) {
      throw await this.toError(res);
    }
    return true;
  }

  // ─── Verified Caller IDs ───────────────────────────────────────────────────

  /**
   * Inicia la verificación de un número como Caller ID saliente.
   * Twilio:
   *   1. Genera un validation_code de 6 dígitos (lo devuelve en la respuesta).
   *   2. Llama al `phoneNumber` y dicta el código por voz.
   *   3. El usuario ingresa el código por DTMF (teclado del teléfono).
   *   4. Twilio confirma → aparece en /OutgoingCallerIds y queda usable
   *      como `From` en /Calls.
   *
   * Importante: el ENDPOINT acá es /Accounts/{Sid}/OutgoingCallerIds.json
   * (POST) y devuelve `validation_code`. NO crea aún el OutgoingCallerId;
   * se crea recién cuando el usuario ingresa el código correcto.
   */
  async createVerifiedCallerId(args: {
    phoneNumber: string;
    friendlyName?: string;
    /** Segundos antes de que Twilio realice la llamada de verificación (0 = inmediato). */
    callDelay?: number;
    /** URL opcional para que Twilio nos pegue cuando termine la verificación. */
    statusCallback?: string;
  }): Promise<VerifiedCallerIdCreateResponse> {
    const body = new URLSearchParams();
    body.set('PhoneNumber', args.phoneNumber);
    if (args.friendlyName) body.set('FriendlyName', args.friendlyName);
    if (args.callDelay != null) body.set('CallDelay', String(args.callDelay));
    if (args.statusCallback) body.set('StatusCallback', args.statusCallback);

    const res = await this.request(
      'POST',
      `Accounts/${encodeURIComponent(this.accountSid)}/OutgoingCallerIds.json`,
      body,
    );
    if (!res.ok) throw await this.toError(res);
    return (await res.json()) as VerifiedCallerIdCreateResponse;
  }

  /**
   * Lista los Verified Caller IDs ya confirmados. Usado para chequear si
   * un número específico ya fue verificado (lookup por PhoneNumber).
   */
  async listVerifiedCallerIds(filter?: {
    phoneNumber?: string;
    friendlyName?: string;
  }): Promise<VerifiedCallerIdResource[]> {
    const params = new URLSearchParams();
    if (filter?.phoneNumber) params.set('PhoneNumber', filter.phoneNumber);
    if (filter?.friendlyName) params.set('FriendlyName', filter.friendlyName);
    const qs = params.toString();
    const path = `Accounts/${encodeURIComponent(this.accountSid)}/OutgoingCallerIds.json${qs ? `?${qs}` : ''}`;

    const res = await this.request('GET', path);
    if (!res.ok) throw await this.toError(res);
    const json = (await res.json()) as TwilioListResponse<VerifiedCallerIdResource>;
    return (json.outgoing_caller_ids as VerifiedCallerIdResource[]) ?? [];
  }

  async deleteVerifiedCallerId(sid: string): Promise<void> {
    const res = await this.request(
      'DELETE',
      `Accounts/${encodeURIComponent(this.accountSid)}/OutgoingCallerIds/${encodeURIComponent(sid)}.json`,
    );
    if (!res.ok && res.status !== 404) throw await this.toError(res);
  }

  // ─── Incoming Phone Numbers ────────────────────────────────────────────────

  async listIncomingPhoneNumbers(filter?: {
    phoneNumber?: string;
    friendlyName?: string;
  }): Promise<IncomingPhoneNumberResource[]> {
    const params = new URLSearchParams();
    if (filter?.phoneNumber) params.set('PhoneNumber', filter.phoneNumber);
    if (filter?.friendlyName) params.set('FriendlyName', filter.friendlyName);
    const qs = params.toString();
    const path = `Accounts/${encodeURIComponent(this.accountSid)}/IncomingPhoneNumbers.json${qs ? `?${qs}` : ''}`;

    const res = await this.request('GET', path);
    if (!res.ok) throw await this.toError(res);
    const json = (await res.json()) as TwilioListResponse<IncomingPhoneNumberResource>;
    return (json.incoming_phone_numbers as IncomingPhoneNumberResource[]) ?? [];
  }

  async updateIncomingPhoneNumber(
    sid: string,
    patch: {
      voiceUrl?: string;
      voiceMethod?: 'GET' | 'POST';
      smsUrl?: string;
      smsMethod?: 'GET' | 'POST';
      statusCallback?: string;
      friendlyName?: string;
    },
  ): Promise<IncomingPhoneNumberResource> {
    const body = new URLSearchParams();
    if (patch.voiceUrl != null) body.set('VoiceUrl', patch.voiceUrl);
    if (patch.voiceMethod) body.set('VoiceMethod', patch.voiceMethod);
    if (patch.smsUrl != null) body.set('SmsUrl', patch.smsUrl);
    if (patch.smsMethod) body.set('SmsMethod', patch.smsMethod);
    if (patch.statusCallback) body.set('StatusCallback', patch.statusCallback);
    if (patch.friendlyName) body.set('FriendlyName', patch.friendlyName);

    const res = await this.request(
      'POST',
      `Accounts/${encodeURIComponent(this.accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`,
      body,
    );
    if (!res.ok) throw await this.toError(res);
    return (await res.json()) as IncomingPhoneNumberResource;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: URLSearchParams,
  ): Promise<Response> {
    const url = `${this.baseUrl}/${API_VERSION}/${path.replace(/^\//, '')}`;
    return fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        ...(body
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : { Accept: 'application/json' }),
      },
      body: body ? body.toString() : undefined,
    });
  }

  private async toError(res: Response): Promise<TwilioApiError> {
    let payload: { message?: string; code?: number } | undefined;
    try {
      payload = await res.json();
    } catch {
      /* ignore */
    }
    return new TwilioApiError(
      payload?.message ?? `Twilio ${res.status} ${res.statusText}`,
      res.status,
      payload?.code,
    );
  }
}

/** Helper para uso recurrente dentro del proyecto. */
export function newTwilioClient(accountSid: string, authToken: string): TwilioRestClient {
  return new TwilioRestClient({ accountSid, authToken });
}
