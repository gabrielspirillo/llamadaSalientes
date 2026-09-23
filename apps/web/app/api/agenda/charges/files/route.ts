import { revalidatePath } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import { type AgendaContext, AgendaForbiddenError, getAgendaContext } from '@/lib/agenda/auth';
import {
  ALLOWED_RECEIPT_MIMES,
  MAX_RECEIPT_BYTES,
  inferChargeFileKind,
  isChargeFileKind,
} from '@/lib/agenda/billing';
import {
  assertChargeAppointmentInScope,
  assertChargeInScope,
  attachChargeFile,
  ensureChargeForAppointment,
} from '@/lib/agenda/charges';
import { AgendaValidationError } from '@/lib/agenda/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sube un comprobante (factura, ticket, justificante) y lo cuelga del cargo de
 * una cita; si la cita todavía no tiene cargo, lo crea PENDIENTE.
 *
 * Va por endpoint y no por Server Action porque lo que se manda es un archivo
 * (multipart) y hace falta rechazarlo por tipo y por tamaño antes de tocar el
 * bucket. El gate de rol se comprueba ACÁ: esconder el botón no protege un POST.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let ctx: AgendaContext;
  try {
    ctx = await getAgendaContext();
  } catch {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  if (!ctx.canWriteAppointments) {
    return NextResponse.json(
      { error: 'Tu rol sólo permite consultar la agenda.' },
      { status: 403 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Se esperaba multipart/form-data' }, { status: 400 });
  }

  const appointmentId = String(form.get('appointmentId') ?? '').trim();
  const chargeId = String(form.get('chargeId') ?? '').trim();
  const kindRaw = String(form.get('kind') ?? '').trim();
  const file = form.get('file');
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
  if (file.size <= 0) {
    return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    const mb = Math.round(MAX_RECEIPT_BYTES / (1024 * 1024));
    return NextResponse.json(
      { error: `El archivo es demasiado grande. Máximo ${mb} MB.` },
      { status: 413 },
    );
  }

  const onlyProfessionalId = ctx.scope === 'OWN' ? ctx.professional?.id : undefined;
  const scope = { tenantId: ctx.tenantId, userId: ctx.userId };
  try {
    let targetChargeId: string;
    if (appointmentId) {
      await assertChargeAppointmentInScope(ctx.tenantId, appointmentId, onlyProfessionalId);
      targetChargeId = (await ensureChargeForAppointment(scope, appointmentId)).id;
    } else if (chargeId) {
      await assertChargeInScope(ctx.tenantId, chargeId, onlyProfessionalId);
      targetChargeId = chargeId;
    } else {
      return NextResponse.json({ error: 'Falta la cita o el cargo' }, { status: 400 });
    }

    const result = await attachChargeFile(scope, {
      chargeId: targetChargeId,
      kind: isChargeFileKind(kindRaw) ? kindRaw : inferChargeFileKind(mime),
      fileName: file.name || 'comprobante',
      mimeType: mime,
      body: Buffer.from(await file.arrayBuffer()),
    });
    revalidatePath(`/dashboard/agenda/pacientes/${encodeURIComponent(result.patientKey)}`);
    return NextResponse.json({ id: result.id, chargeId: targetChargeId }, { status: 201 });
  } catch (err) {
    if (err instanceof AgendaForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof AgendaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[agenda-charges] fallo al subir el comprobante', err);
    return NextResponse.json(
      { error: 'No se pudo subir el comprobante. Revisa el almacenamiento.' },
      { status: 502 },
    );
  }
}
