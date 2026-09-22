import 'server-only';

/**
 * Cliente mínimo de la API v1 de Documenso (instancia propia de cada clínica).
 *
 * Sólo lo que hace falta para el flujo "un clic → el tutor firma desde el
 * móvil": crear el documento con su firmante, subir el PDF, colocar los
 * campos, mandarlo sin correo (el enlace va por WhatsApp) y bajar el PDF
 * firmado cuando Documenso avisa por webhook. Nada de plantillas de Documenso:
 * el PDF lo genera la app con los datos ya rellenos.
 *
 * Toda llamada lleva timeout: una instancia caída no puede colgar una Server
 * Action ni el webhook.
 */

export interface DocumensoConfig {
  /** https://consentimiento.respinens.es (sin barra final). */
  baseUrl: string;
  apiToken: string;
}

export class DocumensoError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'DocumensoError';
  }
}

const TIMEOUT_MS = 20_000;

function base(cfg: DocumensoConfig): string {
  return cfg.baseUrl.replace(/\/+$/, '');
}

async function call<T>(cfg: DocumensoConfig, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base(cfg)}${path}`, {
      ...init,
      headers: {
        Authorization: cfg.apiToken,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new DocumensoError(
      `No se pudo hablar con Documenso (${(err as Error).message}). ¿Está en marcha ${base(cfg)}?`,
    );
  }
  const text = await res.text();
  if (!res.ok) {
    throw new DocumensoError(
      `Documenso respondió ${res.status} en ${path}: ${text.slice(0, 300)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DocumensoError(`Documenso devolvió una respuesta que no es JSON en ${path}`);
  }
}

export interface CreatedDocument {
  documentId: number;
  uploadUrl: string;
  recipientId: number;
  /** Enlace de firma del tutor. Es lo que va por WhatsApp. */
  signingUrl: string;
}

export async function createDocument(
  cfg: DocumensoConfig,
  input: {
    title: string;
    /** Nuestro id del consentimiento: vuelve en el webhook y evita ambigüedades. */
    externalId: string;
    recipient: { name: string; email: string };
    timezone: string;
  },
): Promise<CreatedDocument> {
  const res = await call<{
    documentId: number;
    uploadUrl: string;
    recipients: { recipientId: number; signingUrl: string }[];
  }>(cfg, '/api/v1/documents', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      externalId: input.externalId,
      recipients: [{ name: input.recipient.name, email: input.recipient.email, role: 'SIGNER' }],
      meta: {
        timezone: input.timezone,
        dateFormat: 'dd/MM/yyyy',
        language: 'es',
        // Los correos de Documenso no se usan: el enlace va por WhatsApp.
        emailSettings: {
          recipientSigningRequest: false,
          recipientSigned: false,
          documentCompleted: false,
          ownerDocumentCompleted: false,
          recipientRemoved: false,
          documentPending: false,
          documentDeleted: false,
        },
      },
    }),
  });
  const recipient = res.recipients[0];
  if (!recipient) throw new DocumensoError('Documenso creó el documento sin firmante.');
  return {
    documentId: res.documentId,
    uploadUrl: res.uploadUrl,
    recipientId: recipient.recipientId,
    signingUrl: recipient.signingUrl,
  };
}

/** Sube el PDF a la URL prefirmada que devolvió `createDocument`. */
export async function uploadPdf(
  cfg: DocumensoConfig,
  uploadUrl: string,
  bytes: Uint8Array,
): Promise<void> {
  const put = async (withAuth: boolean) =>
    fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        ...(withAuth ? { Authorization: cfg.apiToken } : {}),
      },
      body: bytes as BodyInit,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  // Una URL prefirmada de S3 rechaza cabeceras de más; la subida "a base de
  // datos" de Documenso, en cambio, es su propio endpoint y pide el token.
  let res = await put(false);
  if (res.status === 401 || res.status === 403) res = await put(true);
  if (!res.ok) {
    throw new DocumensoError(
      `No se pudo subir el PDF a Documenso (${res.status}): ${(await res.text()).slice(0, 200)}`,
      res.status,
    );
  }
}

export type DocumensoFieldType = 'SIGNATURE' | 'DATE' | 'CHECKBOX' | 'TEXT';

export interface DocumensoField {
  recipientId: number;
  type: DocumensoFieldType;
  pageNumber: number;
  /** Porcentajes de la página, origen arriba a la izquierda. */
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
  fieldMeta?: Record<string, unknown>;
}

export async function addFields(
  cfg: DocumensoConfig,
  documentId: number,
  fields: DocumensoField[],
): Promise<void> {
  if (fields.length === 0) return;
  await call(cfg, `/api/v1/documents/${documentId}/fields`, {
    method: 'POST',
    body: JSON.stringify(fields),
  });
}

/** Pasa el documento a "pendiente de firma" sin mandar correos. */
export async function sendDocument(cfg: DocumensoConfig, documentId: number): Promise<void> {
  await call(cfg, `/api/v1/documents/${documentId}/send`, {
    method: 'POST',
    body: JSON.stringify({ sendEmail: false, sendCompletionEmails: false }),
  });
}

export interface DocumensoDocumentStatus {
  id: number;
  status: string;
  completedAt: string | null;
}

export async function getDocument(
  cfg: DocumensoConfig,
  documentId: number,
): Promise<DocumensoDocumentStatus> {
  return call<DocumensoDocumentStatus>(cfg, `/api/v1/documents/${documentId}`);
}

/**
 * Bytes del PDF ya firmado y sellado.
 *
 * Primero la v2 (`/api/v2/document/{id}/download?version=signed`), que sirve
 * el fichero venga de donde venga —también con el almacenamiento en base de
 * datos, que es el de estas instancias—. Si no está o falla, la v1, que
 * devuelve una URL de descarga y hay que ir a por ella en el acto: caduca.
 */
export async function downloadSignedPdf(
  cfg: DocumensoConfig,
  documentId: number,
): Promise<Uint8Array> {
  const fetchBytes = async (url: string, withAuth: boolean): Promise<Response> =>
    fetch(url, {
      headers: withAuth ? { Authorization: cfg.apiToken } : undefined,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const v2 = await fetchBytes(
    `${base(cfg)}/api/v2/document/${documentId}/download?version=signed`,
    true,
  ).catch(() => null);
  if (v2?.ok) {
    const type = v2.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      // Algunas versiones devuelven la URL en vez del fichero.
      const data = (await v2.json().catch(() => null)) as { downloadUrl?: string } | null;
      if (data?.downloadUrl) {
        let file = await fetchBytes(data.downloadUrl, false);
        if (file.status === 401 || file.status === 403) file = await fetchBytes(data.downloadUrl, true);
        if (file.ok) return new Uint8Array(await file.arrayBuffer());
      }
    } else {
      return new Uint8Array(await v2.arrayBuffer());
    }
  }

  const { downloadUrl } = await call<{ downloadUrl: string }>(
    cfg,
    `/api/v1/documents/${documentId}/download`,
  );
  let res = await fetchBytes(downloadUrl, false);
  if (res.status === 401 || res.status === 403) res = await fetchBytes(downloadUrl, true);
  if (!res.ok) {
    throw new DocumensoError(`No se pudo bajar el PDF firmado (${res.status}).`, res.status);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Comprueba que la URL y el token valen: lista una página de documentos. */
export async function testConnection(cfg: DocumensoConfig): Promise<void> {
  await call(cfg, '/api/v1/documents?page=1&perPage=1');
}
