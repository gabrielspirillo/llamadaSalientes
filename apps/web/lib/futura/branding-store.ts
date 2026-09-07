import 'server-only';

import { buildLogoPath } from '@/lib/branding';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { mediaDelete, mediaUpload } from '@/lib/storage/media';
import { eq } from 'drizzle-orm';

/**
 * Bucket donde viven los logos de las clínicas.
 *
 * Tiene que ser de lectura PÚBLICA: el logo va en un <img> del panel en cada
 * render, y firmar una URL que caduca haría que el logo desapareciera solo a
 * las pocas horas. Por defecto reutiliza el bucket público de WhatsApp, que ya
 * cumple esa condición; `S3_BUCKET_BRANDING` permite separarlos sin tocar
 * código. Un logo no es un dato de paciente: aquí no hay nada que firmar.
 */
export function brandingBucket(): string {
  const configured = env.S3_BUCKET_BRANDING?.trim();
  return configured && configured.length > 0 ? configured : env.S3_BUCKET_WHATSAPP;
}

export type SaveLogoInput = {
  tenantId: string;
  body: Buffer;
  mime: string;
};

/**
 * Sube el logo de una clínica y lo deja guardado en su fila.
 *
 * La escritura en la base la hace ESTA función, no quien llama desde el
 * navegador: si el endpoint devolviera la URL para que el cliente la mandara
 * después en un guardado aparte, cualquiera con la sesión podría escribir una
 * URL arbitraria en `logo_url` y el panel la pintaría. Acá la URL sólo puede
 * salir de un archivo que este servidor acaba de subir.
 *
 * Devuelve la URL pública ya persistida.
 */
export async function saveClinicLogo(input: SaveLogoInput): Promise<{ logoUrl: string }> {
  const bucket = brandingBucket();
  const path = buildLogoPath(input.tenantId, input.mime);

  const { publicUrl } = await mediaUpload({
    bucket,
    path,
    body: input.body,
    contentType: input.mime,
  });

  // El logo anterior se lee ANTES de pisarlo: es la única forma de saber qué
  // objeto quedó huérfano en el bucket.
  const rows = await db
    .select({ logoPath: tenants.logoPath })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  const previousPath = rows[0]?.logoPath ?? null;

  await db
    .update(tenants)
    .set({ logoUrl: publicUrl, logoPath: path })
    .where(eq(tenants.id, input.tenantId));

  if (previousPath && previousPath !== path) {
    try {
      await mediaDelete(previousPath, { bucket });
    } catch (err) {
      // Best-effort: el logo nuevo ya está guardado y visible. Fallar acá sólo
      // conseguiría que pareciera que la subida no funcionó.
      console.warn('[futura-branding] no se pudo borrar el logo anterior', err);
    }
  }

  return { logoUrl: publicUrl };
}
