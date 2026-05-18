#!/usr/bin/env -S tsx
/* eslint-disable no-console */
/**
 * Copia objetos del bucket de Supabase Storage al MinIO self-hosted.
 *
 * Corre con tsx desde la raíz del repo (NO necesita estar en el servidor —
 * descarga de Supabase, sube a MinIO público).
 *
 * Uso:
 *   export SUPABASE_URL='https://<ref>.supabase.co'
 *   export SUPABASE_SERVICE_ROLE_KEY='...'
 *   export SUPABASE_BUCKET='whatsapp-media'
 *   export S3_ENDPOINT='https://s3.futuradigital.es'
 *   export S3_ACCESS_KEY='...'
 *   export S3_SECRET_KEY='...'
 *   export S3_BUCKET='whatsapp-media'
 *   tsx scripts/migrate/03-copy-storage.ts
 *
 * Notas:
 * - Idempotente: si el objeto ya existe en MinIO con mismo tamaño, se skipea.
 * - Concurrencia: 4 descargas/subidas en paralelo.
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

type SupabaseListItem = { name: string; metadata?: { mimetype?: string; size?: number } };

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta env ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = need('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? 'whatsapp-media';
const S3_ENDPOINT = need('S3_ENDPOINT');
const S3_BUCKET = process.env.S3_BUCKET ?? 'whatsapp-media';

const s3 = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: need('S3_ACCESS_KEY'),
    secretAccessKey: need('S3_SECRET_KEY'),
  },
});

async function listSupabase(prefix = ''): Promise<SupabaseListItem[]> {
  // La API REST de Supabase Storage permite listar recursivamente con
  // /storage/v1/object/list/{bucket}. Vamos profundidad-primera.
  const items: SupabaseListItem[] = [];
  const queue: string[] = [prefix];
  while (queue.length) {
    const current = queue.shift()!;
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_BUCKET}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prefix: current,
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        }),
      },
    );
    if (!res.ok) throw new Error(`list ${current}: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as SupabaseListItem[];
    for (const r of rows) {
      const isFolder = !r.metadata; // Supabase marca folders sin metadata
      const fullPath = current ? `${current}/${r.name}` : r.name;
      if (isFolder) queue.push(fullPath);
      else items.push({ ...r, name: fullPath });
    }
  }
  return items;
}

async function downloadFromSupabase(path: string): Promise<{ body: Buffer; contentType: string }> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`,
    { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) throw new Error(`get ${path}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') ?? 'application/octet-stream';
  return { body: buf, contentType: ct };
}

async function existsInMinio(key: string, expectedSize?: number): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    if (expectedSize && head.ContentLength !== expectedSize) return false;
    return true;
  } catch {
    return false;
  }
}

async function uploadToMinio(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'max-age=3600',
    }),
  );
}

async function migrateOne(item: SupabaseListItem): Promise<'copied' | 'skipped' | 'failed'> {
  const key = item.name;
  const size = item.metadata?.size;
  try {
    if (await existsInMinio(key, size)) return 'skipped';
    const { body, contentType } = await downloadFromSupabase(key);
    const finalCt = item.metadata?.mimetype ?? contentType;
    await uploadToMinio(key, body, finalCt);
    return 'copied';
  } catch (err) {
    console.error(`[copy] ${key} FALLÓ:`, (err as Error).message);
    return 'failed';
  }
}

async function main(): Promise<void> {
  console.log(`[storage-migration] inventario Supabase bucket=${SUPABASE_BUCKET}…`);
  const items = await listSupabase();
  console.log(`[storage-migration] ${items.length} objetos a procesar`);

  const counters = { copied: 0, skipped: 0, failed: 0 };
  const CONCURRENCY = 4;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(migrateOne));
    for (const r of results) counters[r] += 1;
    if ((i / CONCURRENCY) % 5 === 0) {
      console.log(`[storage-migration] progreso ${i + batch.length}/${items.length}`, counters);
    }
  }

  console.log('[storage-migration] DONE', counters);
  if (counters.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
