import 'server-only';
import {
  GetObjectCommand,
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

export async function mediaUpload(input: UploadInput): Promise<UploadResult> {
  const bucket = input.bucket ?? env.S3_BUCKET_WHATSAPP;
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.path,
      Body: input.body,
      ContentType: input.contentType,
      CacheControl: 'max-age=3600',
    }),
  );
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
  options?: { bucket?: string; expiresInSeconds?: number },
): Promise<string> {
  const bucket = options?.bucket ?? env.S3_BUCKET_WHATSAPP;
  const expiresIn = options?.expiresInSeconds ?? 60 * 60 * 24; // 24h
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: path }),
    { expiresIn },
  );
}

export function buildWhatsappMediaPath(
  tenantId: string,
  conversationId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `tenants/${tenantId}/whatsapp/${conversationId}/${crypto.randomUUID()}.${safeExt}`;
}
