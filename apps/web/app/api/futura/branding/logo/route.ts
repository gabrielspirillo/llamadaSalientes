import { type NextRequest, NextResponse } from 'next/server';

import {
  ALLOWED_LOGO_LABEL,
  ALLOWED_LOGO_MIMES,
  MAX_LOGO_BYTES,
  normalizeMime,
} from '@/lib/branding';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema';
import { saveClinicLogo } from '@/lib/futura/branding-store';
import { getCurrentTenant } from '@/lib/tenant';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sube el logo de una clínica. Sólo Futura (super-admin).
 *
 * Va por endpoint y no por Server Action porque lo que se manda es un archivo
 * (multipart) y hace falta poder rechazarlo por tipo y por tamaño antes de
 * tocar el bucket.
 *
 * El gate se comprueba ACÁ, en el servidor: esconder el botón del panel no
 * protege un POST. `getCurrentTenant().isSuperAdmin` mira siempre al usuario
 * real, no al que se esté gestionando por impersonación.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { isSuperAdmin } = await getCurrentTenant();
  if (!isSuperAdmin) {
    // 404 y no 403: quien no es de Futura no tiene por qué saber que esto
    // existe. Es lo mismo que hace la página del panel Futura.
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const tenantId = String(form.get('tenantId') ?? '').trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'Falta la clínica' }, { status: 400 });
  }

  // Que el tenant exista se comprueba antes de subir nada: si no, se quedaría
  // un objeto en el bucket que no pertenece a ninguna clínica.
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!rows[0]) {
    return NextResponse.json({ error: 'La clínica no existe' }, { status: 404 });
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  }

  const mime = normalizeMime(file.type);
  if (!ALLOWED_LOGO_MIMES.has(mime)) {
    return NextResponse.json(
      { error: `Formato no permitido. Usa ${ALLOWED_LOGO_LABEL}.` },
      { status: 415 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
  }
  if (file.size > MAX_LOGO_BYTES) {
    const mb = Math.round(MAX_LOGO_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `El logo es demasiado grande. Máximo ${mb} MB.` },
      { status: 413 },
    );
  }

  try {
    const { logoUrl } = await saveClinicLogo({
      tenantId: rows[0].id,
      body: Buffer.from(await file.arrayBuffer()),
      mime,
    });
    return NextResponse.json({ logoUrl }, { status: 201 });
  } catch (err) {
    console.error('[futura-branding] fallo al subir el logo', err);
    return NextResponse.json(
      { error: 'No se pudo subir el logo. Revisa el almacenamiento.' },
      { status: 502 },
    );
  }
}
