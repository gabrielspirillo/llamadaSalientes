import 'server-only';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '@/lib/env';

// Cliente S3 genérico para el storage de media de WhatsApp.
//
// Diseñado para MinIO self-hosted (Dokploy) pero compatible con cualquier
// proveedor S3 (R2, AWS S3, Wasabi, etc.) cambiando solo las env vars:
//   - S3_ENDPOINT          → URL base del servicio (https://s3.futuradigital.es)
//   - S3_REGION            → arbitrario para MinIO (default us-east-1)
//   - S3_ACCESS_KEY        → access key
//   - S3_SECRET_KEY        → secret key
//   - S3_BUCKET_WHATSAPP   → nombre del bucket (debe existir, idealmente público)
//   - S3_FORCE_PATH_STYLE  → "true" para MinIO; algunas configs de R2/AWS lo requieren
//   - S3_PUBLIC_BASE_URL   → opcional. URL pública base para construir links.
//                            Si está, se usa en lugar del endpoint interno.

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 media storage no configurado: faltan S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY',
    );
  }
  _client = new S3Client({
    region: env.S3_REGION,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return _client;
}

function publicBase(): string {
  // Para bucket público, construimos la URL directamente. El servidor MinIO
  // detrás de Traefik suele exponerse en `s3.<dominio>` con path-style.
  return env.S3_PUBLIC_BASE_URL ?? env.S3_ENDPOINT ?? '';
}

export type UploadInput = {
  bucket?: string;
  path: string; // key dentro del bucket. Ej: tenants/<id>/whatsapp/<conv>/<uuid>.jpg
  body: Buffer | Uint8Array;
  contentType: string;
};

export type UploadResult = {
  path: string;
  publicUrl: string;
};

function isNoSuchBucket(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; message?: string };
  return (
    e?.name === 'NoSuchBucket' ||
    e?.Code === 'NoSuchBucket' ||
    /specified bucket does not exist/i.test(e?.message ?? '')
  );
}

export async function mediaUpload(input: UploadInput): Promise<UploadResult> {
  const bucket = input.bucket ?? env.S3_BUCKET_WHATSAPP;
  const client = getClient();
  const put = () =>
    client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.path,
        Body: input.body,
        ContentType: input.contentType,
        CacheControl: 'max-age=3600',
      }),
    );
  try {
    await put();
  } catch (err) {
    if (!isNoSuchBucket(err)) throw err;
    // El bucket no existe todavía (pasó con el interno en producción: los PDF
    // firmados, las facturas y los comprobantes no se podían guardar). Se crea
    // privado —lo es por defecto en S3 y en MinIO— y se reintenta una vez.
    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch((createErr) => {
      const name = (createErr as { name?: string }).name;
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw createErr;
    });
    await put();
  }
  const base = publicBase().replace(/\/$/, '');
  // path-style: <base>/<bucket>/<key>. Es el formato que sirve MinIO por
  // default y también funciona con S3 cuando S3_FORCE_PATH_STYLE=true.
  const publicUrl = `${base}/${bucket}/${input.path}`;
  return { path: input.path, publicUrl };
}

/**
 * URL firmada (presigned GET). Necesaria si el bucket no es público o si
 * queremos pasar la URL a un servicio externo (Meta/Twilio/Evolution) que
 * deba descargar el media sin acceso al bucket.
 */
export async function mediaSignedUrl(
  path: string,
  options?: {
    bucket?: string;
    expiresInSeconds?: number;
    /** Fuerza la descarga con este nombre (Content-Disposition: attachment). */
    downloadName?: string;
    /**
     * Firma contra la URL pública (`S3_PUBLIC_BASE_URL`) en vez del endpoint
     * interno: hace falta cuando el enlace lo abre alguien de fuera —el
     * navegador del usuario, el proveedor de WhatsApp—. Una firma v4 lleva el
     * host dentro, así que la del endpoint interno no vale desde fuera.
     */
    publicHost?: boolean;
  },
): Promise<string> {
  const bucket = options?.bucket ?? env.S3_BUCKET_WHATSAPP;
  const expiresIn = options?.expiresInSeconds ?? 60 * 60 * 24; // 24h
  const client = options?.publicHost ? getPublicClient() : getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: path,
      ...(options?.downloadName
        ? {
            ResponseContentDisposition: `attachment; filename="${options.downloadName.replace(/["\\\r\n]/g, '')}"`,
          }
        : {}),
    }),
    { expiresIn },
  );
}

let _publicClient: S3Client | null = null;

/** Como `getClient`, pero apuntando a la URL pública si la hay. */
function getPublicClient(): S3Client {
  if (!env.S3_PUBLIC_BASE_URL) return getClient();
  if (_publicClient) return _publicClient;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;
  if (!accessKeyId || !secretAccessKey) return getClient();
  _publicClient = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_PUBLIC_BASE_URL,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  return _publicClient;
}

/**
 * Borra un objeto. Pensado para reemplazos (cambiar el logo de una clínica):
 * sin esto cada cambio deja el archivo anterior en el bucket para siempre.
 *
 * Quien lo llama debe tratarlo como best-effort: que no se pueda borrar el
 * objeto viejo nunca es motivo para tumbar la operación que ya guardó el nuevo.
 */
export async function mediaDelete(path: string, options?: { bucket?: string }): Promise<void> {
  const bucket = options?.bucket ?? env.S3_BUCKET_WHATSAPP;
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
}

export function buildWhatsappMediaPath(
  tenantId: string,
  conversationId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `tenants/${tenantId}/whatsapp/${conversationId}/${crypto.randomUUID()}.${safeExt}`;
}

/**
 * Sirve un objeto del bucket A TRAVÉS DE LA APP, sin redirigir a MinIO.
 *
 * Redirigir a una URL firmada mandaba al navegador al endpoint interno
 * (`cliniq-minio-…:9000`), que fuera de Docker no existe: el PDF del
 * consentimiento, los comprobantes y los adjuntos daban "No se puede acceder
 * a este sitio". Así el enlace es siempre de la propia app y el bucket puede
 * seguir siendo privado. Devuelve null si el objeto no existe.
 */
export async function mediaFileResponse(
  path: string,
  options: { bucket?: string; filename?: string; download?: boolean; contentType?: string } = {},
): Promise<Response | null> {
  const bucket = options.bucket ?? env.S3_BUCKET_WHATSAPP;
  let out: GetObjectCommandOutput;
  try {
    out = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: path }), {
      abortSignal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound' || isNoSuchBucket(err)) return null;
    throw err;
  }
  if (!out.Body) return null;
  // Las cabeceras sólo admiten ASCII: "Lucía.pdf" → "Lucia.pdf".
  const filename =
    (options.filename ?? path.split('/').pop() ?? 'archivo')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\x20-\x7e]|["\\]/g, '')
      .trim() || 'archivo';
  const headers = new Headers({
    'Content-Type': options.contentType ?? out.ContentType ?? 'application/octet-stream',
    'Content-Disposition': `${options.download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (out.ContentLength) headers.set('Content-Length', String(out.ContentLength));
  return new Response(out.Body.transformToWebStream(), { status: 200, headers });
}
