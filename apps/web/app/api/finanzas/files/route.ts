import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  inferChargeFileKind,
  isChargeFileKind,
} from '@/lib/agenda/billing';
import { recordAudit } from '@/lib/audit';
import {
  type FinanceAccess,
  FinanceForbiddenError,
  requireFinanceWriter,
} from '@/lib/finance/auth';
import { FinanceValidationError, attachEntryFile } from '@/lib/finance/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sube un comprobante (factura, ticket, justificante) y lo cuelga de un
 * movimiento del libro. Va por endpoint y no por Server Action porque lo que
 * se manda es un archivo (multipart) y hay que rechazarlo por tipo y por
 * tamaño antes de tocar el bucket. El gate de rol se comprueba ACÁ.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let ctx: FinanceAccess;
  try {
    ctx = await requireFinanceWriter();
  } catch (err) {
    if (err instanceof FinanceForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const entryId = String(form.get('entryId') ?? '').trim();
  const kindRaw = String(form.get('kind') ?? '').trim();
  const file = form.get('file');
  if (!entryId) return NextResponse.json({ error: 'Falta el movimiento' }, { status: 400 });
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
  }
  const mime = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!ALLOWED_RECEIPT_MIMES.has(mime)) {
    return NextResponse.json(
      { error: 'Formato no permitido. Sube un PDF o una foto.' },
      { status: 415 },
    );
  }
  if (file.size <= 0) return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
  if (file.size > MAX_RECEIPT_BYTES) {
    const mb = Math.round(MAX_RECEIPT_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `El archivo es demasiado grande. Máximo ${mb} MB.` },
      { status: 413 },
    );
  }

  try {
    const result = await attachEntryFile(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      {
        entryId,
        kind: isChargeFileKind(kindRaw) ? kindRaw : inferChargeFileKind(mime),
        fileName: file.name || 'comprobante',
        mimeType: mime,
        body: Buffer.from(await file.arrayBuffer()),
      },
    );
    await recordAudit({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      action: 'update',
      entity: 'finance_entry',
      entityId: entryId,
      after: { file: file.name || 'comprobante' },
    }).catch(() => undefined);
    revalidatePath('/dashboard/finanzas');
    return NextResponse.json({ id: result.id, entryId }, { status: 201 });
  } catch (err) {
    if (err instanceof FinanceValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[finanzas] fallo al subir el comprobante', err);
    return NextResponse.json(
      { error: 'No se pudo subir el comprobante. Revisa el almacenamiento.' },
      { status: 502 },
    );
  }
}
