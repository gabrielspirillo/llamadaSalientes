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

interface RemoteRecipient {
  role?: string;
  email?: string;
  token?: string;
}

interface RemoteDocument {
  id?: number | string;
  secondaryId?: string;
  externalId?: string | null;
  recipients?: RemoteRecipient[];
}

function unwrapDocument(raw: unknown): RemoteDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc =
    'recipients' in raw || 'externalId' in raw ? raw : (raw as { document?: unknown }).document;
  return doc && typeof doc === 'object' ? (doc as RemoteDocument) : null;
}

/**
 * El documento que se acaba de crear, COMPROBADO: id y enlace de firma
 * (`<instancia>/sign/<token del firmante>`), que es lo que va por WhatsApp.
 *
 * ⚠️ Antes se leía el documento por el `id` numérico que devuelve el alta y se
 * cogía el primer firmante sin mirar nada más. En producción ese enlace llegó
 * a abrir el consentimiento de OTRO niño (Respinens, octubre de 2026): el
 * mensaje salía al tutor correcto pero con el documento de otra familia. Ahora
 * sólo vale un documento que lleve NUESTRO `externalId` y cuyo firmante sea el
 * correo con el que se creó; se busca primero por el sobre (`envelopeId`, un
 * identificador único de texto) y después por el id numérico. Si ninguno
 * cuadra no se devuelve enlace: es preferible no mandar nada a mandar los
 * datos de otro paciente.
 */
export async function resolveCreatedDocument(
  cfg: DocumensoConfig,
  created: CreatedDocument,
  expected: { externalId: string; recipientEmail: string },
): Promise<{ documentId: number; signingUrl: string }> {
  const email = expected.recipientEmail.trim().toLowerCase();
  const sources: { path: string; documentIdOf: (doc: RemoteDocument) => number }[] = [
    {
      path: `/api/v2/envelope/${encodeURIComponent(created.envelopeId)}`,
      documentIdOf: (doc) => {
        const m = /(\d+)$/.exec(doc.secondaryId ?? '');
        return m ? Number(m[1]) : created.documentId;
      },
    },
    {
      path: `/api/v2/document/${created.documentId}`,
      documentIdOf: (doc) => (typeof doc.id === 'number' ? doc.id : created.documentId),
    },
  ];
  for (const source of sources) {
    const doc = unwrapDocument(await call<unknown>(cfg, source.path).catch(() => null));
    if (!doc || doc.externalId !== expected.externalId) continue;
    const signer = (doc.recipients ?? []).find(
      (r) => r.token && (r.email ?? '').trim().toLowerCase() === email,
    );
    if (!signer?.token) continue;
    return {
      documentId: source.documentIdOf(doc),
      signingUrl: `${base(cfg)}/sign/${signer.token}`,
    };
  }
  throw new DocumensoError(
    'Documenso no devolvió el documento que se acaba de crear (no coincide el identificador ni el firmante). No se ha enviado nada: vuelve a intentarlo.',
  );
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
  /** Nuestro id del consentimiento, si la instancia lo devuelve. */
  externalId: string | null;
}

/**
 * Estado del documento. Primero la v2 y, si no responde con un documento
 * (404, `null`, otra forma según la versión de la instancia), la v1. Antes
 * una respuesta `null` de la v2 reventaba al leer `status` y "Comprobar firma"
 * sólo decía "No se pudo completar la operación".
 */
export async function getDocument(
  cfg: DocumensoConfig,
  documentId: number,
): Promise<DocumensoDocumentStatus> {
  const v2 = await call<unknown>(cfg, `/api/v2/document/${documentId}`).catch((err) => {
    if (err instanceof DocumensoError && err.status !== null && err.status < 500) return null;
    throw err;
  });
  const fromV2 = asDocumentStatus(v2);
  if (fromV2) return fromV2;
  const fromV1 = asDocumentStatus(await call<unknown>(cfg, `/api/v1/documents/${documentId}`));
  if (fromV1) return fromV1;
  throw new DocumensoError(
    `Documenso no devolvió el documento ${documentId}. ¿Se borró o es de otra cuenta?`,
  );
}

function asDocumentStatus(raw: unknown): DocumensoDocumentStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  // Algunas versiones envuelven la respuesta (`{ document: {...} }`).
  const doc = (
    'status' in raw ? raw : ((raw as { document?: unknown }).document ?? null)
  ) as Record<string, unknown> | null;
  if (!doc || typeof doc.status !== 'string') return null;
  const completedAt = typeof doc.completedAt === 'string' ? doc.completedAt : null;
  return {
    id: typeof doc.id === 'number' ? doc.id : Number(doc.id),
    status: doc.status.toUpperCase(),
    completedAt: completedAt && !Number.isNaN(Date.parse(completedAt)) ? completedAt : null,
    externalId: typeof doc.externalId === 'string' ? doc.externalId : null,
  };
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
