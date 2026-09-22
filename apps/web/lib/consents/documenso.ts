import 'server-only';

/**
 * Cliente mínimo de la API v2 de Documenso (instancia propia de cada clínica).
 *
 * Sólo lo que hace falta para el flujo "un clic → el tutor firma desde el
 * móvil": crear el documento con el PDF, el firmante y sus campos en UNA
 * llamada (multipart), leer el token del firmante para armar su enlace,
 * distribuirlo sin correo (el enlace va por WhatsApp) y bajar el PDF sellado
 * cuando Documenso avisa por webhook. Nada de plantillas de Documenso: el PDF
 * lo genera la app con los datos ya rellenos.
 *
 * Por qué v2 y no v1: con el almacenamiento en base de datos (el de estas
 * instancias, sin S3) la v1 responde "Create document is not available
 * without S3 transport" — su alta va por URL prefirmada. La v2 sube el fichero
 * en la misma petición, como la propia interfaz de Documenso.
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
    // Con FormData el Content-Type (y su boundary) lo pone fetch.
    const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
    res = await fetch(`${base(cfg)}${path}`, {
      ...init,
      headers: {
        Authorization: cfg.apiToken,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
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

export type DocumensoFieldType = 'SIGNATURE' | 'DATE';

/** Campo del firmante. Porcentajes de la página, origen arriba a la izquierda. */
export interface DocumensoField {
  type: DocumensoFieldType;
  pageNumber: number;
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

export interface CreatedDocument {
  documentId: number;
  envelopeId: string;
}

/**
 * Crea el documento con el PDF, el tutor como único firmante y sus campos, en
 * una sola petición multipart. Los correos de Documenso quedan apagados: el
 * enlace de firma sale por WhatsApp.
 */
export async function createDocument(
  cfg: DocumensoConfig,
  input: {
    title: string;
    /** Nuestro id del consentimiento: vuelve en el webhook y evita ambigüedades. */
    externalId: string;
    recipient: { name: string; email: string };
    fields: DocumensoField[];
    timezone: string;
    pdf: Uint8Array;
    filename?: string;
  },
): Promise<CreatedDocument> {
  const payload = {
    title: input.title,
    externalId: input.externalId,
    recipients: [
      {
        name: input.recipient.name,
        email: input.recipient.email,
        role: 'SIGNER',
        fields: input.fields.map((f) => ({
          type: f.type,
          pageNumber: f.pageNumber,
          pageX: f.pageX,
          pageY: f.pageY,
          width: f.width,
          height: f.height,
          fieldMeta: { type: f.type === 'SIGNATURE' ? 'signature' : 'date', required: true },
        })),
      },
    ],
    meta: {
      timezone: input.timezone,
      dateFormat: 'dd/MM/yyyy',
      language: 'es',
      distributionMethod: 'NONE',
      signingOrder: 'PARALLEL',
      typedSignatureEnabled: true,
      drawSignatureEnabled: true,
      uploadSignatureEnabled: false,
      emailSettings: {
        recipientSigningRequest: false,
        recipientRemoved: false,
        recipientSigned: false,
        documentPending: false,
        documentCompleted: false,
        documentDeleted: false,
        ownerDocumentCompleted: false,
        ownerRecipientExpired: false,
        ownerDocumentCreated: false,
      },
    },
  };

  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append(
    'file',
    new Blob([input.pdf as BlobPart], { type: 'application/pdf' }),
    input.filename ?? 'consentimiento.pdf',
  );

  const res = await call<{ envelopeId: string; id: number }>(cfg, '/api/v2/document/create', {
    method: 'POST',
    body: form,
  });
  return { documentId: res.id, envelopeId: res.envelopeId };
}

/**
 * El enlace de firma del tutor: `<instancia>/sign/<token del firmante>`. Es
 * lo que va por WhatsApp. Se lee del documento porque el alta no lo devuelve.
 */
export async function getSigningUrl(cfg: DocumensoConfig, documentId: number): Promise<string> {
  const doc = await call<{
    recipients?: { id: number; role: string; token: string }[];
  }>(cfg, `/api/v2/document/${documentId}`);
  const signer = (doc.recipients ?? []).find((r) => r.role === 'SIGNER') ?? doc.recipients?.[0];
  if (!signer?.token) throw new DocumensoError('Documenso creó el documento sin firmante.');
  return `${base(cfg)}/sign/${signer.token}`;
}

/** Pasa el documento a "pendiente de firma" sin mandar correos. */
export async function distributeDocument(cfg: DocumensoConfig, documentId: number): Promise<void> {
  await call(cfg, '/api/v2/document/distribute', {
    method: 'POST',
    body: JSON.stringify({ documentId, meta: { distributionMethod: 'NONE' } }),
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
  return call<DocumensoDocumentStatus>(cfg, `/api/v2/document/${documentId}`);
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
        if (file.status === 401 || file.status === 403)
          file = await fetchBytes(data.downloadUrl, true);
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
