import 'server-only';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

// Storage S3-compatible para grabaciones de Retell. Soporta:
//   - Cloudflare R2 (default si NO se setea R2_ENDPOINT): endpoint derivado
//     de R2_ACCOUNT_ID con virtual-host style.
//   - Cualquier S3-compatible self-hosted (MinIO en Dokploy, AWS S3, Wasabi):
//     setear R2_ENDPOINT explícito + R2_FORCE_PATH_STYLE=true para MinIO.
// El nombre del módulo se conserva ("r2") por compat con los callers, pero
// internamente ya no asume el proveedor.

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Recordings storage no configurado: faltan R2_ACCESS_KEY_ID y/o R2_SECRET_ACCESS_KEY',
    );
  }

  // Endpoint: explícito (MinIO/otros) o derivado del account_id (R2 nativo).
  const explicitEndpoint = process.env.R2_ENDPOINT;
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = explicitEndpoint
    ? explicitEndpoint
    : accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : null;
  if (!endpoint) {
    throw new Error(
      'Recordings storage no configurado: setear R2_ENDPOINT (MinIO/S3) o R2_ACCOUNT_ID (R2 nativo)',
    );
  }

  const region = process.env.R2_REGION ?? (explicitEndpoint ? 'us-east-1' : 'auto');
  const forcePathStyle = (process.env.R2_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';

  _client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle,
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
