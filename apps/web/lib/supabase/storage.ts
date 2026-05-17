import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

// Cliente con service_role: bypassea RLS para escribir/leer en buckets desde
// server actions. NUNCA exponer este cliente al browser.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase Storage no configurado: faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

export type UploadInput = {
  bucket?: string; // default: env.SUPABASE_WHATSAPP_BUCKET
  path: string; // ruta dentro del bucket, ej: tenants/<id>/whatsapp/<conv>/<uuid>.jpg
  body: Buffer | Uint8Array;
  contentType: string;
};

export type UploadResult = {
  path: string;
  publicUrl: string;
};

export async function supabaseUpload(input: UploadInput): Promise<UploadResult> {
  const bucket = input.bucket ?? env.SUPABASE_WHATSAPP_BUCKET;
  const client = getClient();
  const { error } = await client.storage
    .from(bucket)
    .upload(input.path, input.body, {
      contentType: input.contentType,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) {
    throw new Error(`Supabase Storage upload falló: ${error.message}`);
  }
  const { data } = client.storage.from(bucket).getPublicUrl(input.path);
  return { path: input.path, publicUrl: data.publicUrl };
}

/**
 * Genera una URL firmada (caso bucket privado). Por defecto el bucket
 * whatsapp-media es público y `getPublicUrl()` es suficiente. Si en el
 * futuro lo hacemos privado, usar esta función con un TTL razonable
 * (ej. 24 h) para que Meta/Twilio/Evolution puedan descargar el media.
 */
export async function supabaseSignedUrl(
  path: string,
  options?: { bucket?: string; expiresInSeconds?: number },
): Promise<string> {
  const bucket = options?.bucket ?? env.SUPABASE_WHATSAPP_BUCKET;
  const expiresIn = options?.expiresInSeconds ?? 60 * 60 * 24; // 24 h
  const { data, error } = await getClient().storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new Error(`Supabase Storage signed URL falló: ${error?.message ?? 'unknown'}`);
  }
  return data.signedUrl;
}

export function buildWhatsappMediaPath(
  tenantId: string,
  conversationId: string,
  ext: string,
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `tenants/${tenantId}/whatsapp/${conversationId}/${crypto.randomUUID()}.${safeExt}`;
}
