import { randomUUID } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { MessagingNotFoundError, requireMessagingRole } from '@/lib/messaging/auth';
import { MAX_ATTACHMENT_BYTES } from '@/lib/messaging/constants';
import { mediaSignedUrl, mediaUpload } from '@/lib/storage/media';

export const runtime = 'nodejs';

/**
 * Lectura de un adjunto: firma la URL EN CADA LECTURA y redirige.
 *
 * Por qué no se guarda la URL firmada en el mensaje: caduca. Un adjunto de hace
 * una semana tiene que seguir abriéndose, así que lo durable es la `key` y la
 * URL se acuña al leer. Guardarla en el jsonb haría que los adjuntos murieran
 * en silencio a las pocas horas — que es peor que fallar al subirlos.
 *
 * Aislamiento: la key lleva el tenant embebido, así que se exige que empiece por
 * el prefijo del tenant del que pide. Sin eso, conocer una key de otra clínica
 * bastaría para leer su adjunto.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const key = req.nextUrl.searchParams.get('key') ?? '';
    const prefix = `tenants/${auth.tenantId}/messaging/`;
    if (!key.startsWith(prefix) || key.includes('..')) {
      throw new MessagingNotFoundError('Adjunto');
    }

    const bucket = internalBucket();
    const url = await mediaSignedUrl(key, {
      ...(bucket ? { bucket } : {}),
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return messagingErrorResponse(err);
  }
}

export const dynamic = 'force-dynamic';

/**
 * Bucket propio del chat interno. Un adjunto acá puede ser una radiografía o
 * un informe con datos de paciente: no comparte bucket con `whatsapp-media`,
 * que es de lectura pública. Si la env no está seteada cae al default de
 * `mediaUpload`, pero la URL que devolvemos siempre es firmada y efímera.
 */
function internalBucket(): string | undefined {
  const b = process.env.S3_BUCKET_INTERNAL?.trim();
  return b && b.length > 0 ? b : undefined;
}

/** Cuánto vive el link que ve el navegador. Corto a propósito. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

// Allowlist explícita. Nada de `image/*`: un SVG es HTML ejecutable y un
// `application/*` cualquiera es un binario que no queremos servir.
const ALLOWED_MIMES = new Set<string>([
  // Imágenes
  'image/jpeg',
  'image/pjpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  // Documentos
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/rtf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  // Audio
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  // Video
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/mpeg',
]);

/** Extensión de respaldo cuando el nombre del archivo no trae ninguna. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'application/rtf': 'rtf',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'weba',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/mpeg': 'mpeg',
};

function extFor(fileName: string, mime: string): string {
  const fromName = (fileName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName.length >= 1 && fromName.length <= 8) return fromName;
  return EXT_BY_MIME[mime] ?? 'bin';
}

/**
 * Sube un adjunto y devuelve la referencia que después viaja dentro del
 * mensaje (`ImAttachment`). Se devuelve `key`, no una URL permanente: quien
 * quiera ver el archivo tiene que pedir una firma nueva.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return badRequest([{ message: 'Se esperaba multipart/form-data', path: ['file'] }]);
    }

    const file = form.get('file');
    if (!file || !(file instanceof File)) {
      return badRequest([{ message: 'Falta el archivo', path: ['file'] }]);
    }

    // El navegador puede mandar `text/plain; charset=utf-8`: nos quedamos con el tipo.
    const rawMime = file.type || 'application/octet-stream';
    const mime = (rawMime.split(';')[0] ?? rawMime).trim().toLowerCase();
    if (!ALLOWED_MIMES.has(mime)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido: ${mime}` },
        { status: 415 },
      );
    }
    if (file.size <= 0) {
      return badRequest([{ message: 'El archivo está vacío', path: ['file'] }]);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024));
      return NextResponse.json(
        { error: `Archivo demasiado grande. Máximo ${mb} MB.` },
        { status: 413 },
      );
    }

    const name = (file.name || 'archivo').slice(0, 255);
    const key = `tenants/${auth.tenantId}/messaging/${randomUUID()}.${extFor(name, mime)}`;
    const bucket = internalBucket();

    await mediaUpload({
      ...(bucket ? { bucket } : {}),
      path: key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: mime,
    });

    // URL firmada y de vida corta. Si el firmado falla (endpoint mal
    // configurado) el adjunto igual queda subido y referenciable por `key`.
    let url: string | null = null;
    try {
      url = await mediaSignedUrl(key, {
        ...(bucket ? { bucket } : {}),
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      });
    } catch (err) {
      console.warn('[messaging-attachments] no se pudo firmar la URL', err);
    }

    return NextResponse.json(
      { key, name, mime, size: file.size, ...(url ? { url } : {}) },
      { status: 201 },
    );
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
