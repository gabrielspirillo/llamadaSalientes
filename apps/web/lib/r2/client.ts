import 'server-only';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Cloudflare R2 es S3-compatible. Endpoint = https://<account_id>.r2.cloudflarestorage.com
// Bucket es el nombre exacto, NO va prefijado en la URL.

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials no configuradas (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export type UploadInput = {
  key: string; // ruta dentro del bucket. Ej: tenants/<id>/calls/<id>.wav
  body: Buffer | Uint8Array;
  contentType: string;
};

export async function r2Upload(input: UploadInput): Promise<{ key: string; bucket: string }> {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error('R2_BUCKET no configurada');

  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  return { key: input.key, bucket };
}

/**
 * Descarga un recurso público (ej: la grabación firmada que devuelve Retell)
 * y lo retorna como Buffer. Útil como input para r2Upload.
 */
export async function fetchAsBuffer(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} falló: ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export function buildRecordingKey(tenantId: string, callId: string, ext = 'wav'): string {
  return `tenants/${tenantId}/calls/${callId}.${ext}`;
}
