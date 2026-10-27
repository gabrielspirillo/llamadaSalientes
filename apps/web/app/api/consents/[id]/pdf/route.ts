import { isUuid } from '@/lib/agenda/appointment-ref';
import { NextResponse } from 'next/server';

import { canOpenPatientDocument, getAgendaContext } from '@/lib/agenda/auth';
import { consentPdfResponse } from '@/lib/consents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El PDF firmado de un consentimiento. Se sirve a través de la app (no se
 * redirige a MinIO, cuya dirección interna no existe fuera de Docker); lo
 * durable es la key en el bucket interno. `?download` lo baja como adjunto.
 * La fila se busca por (clínica de la sesión, id): un id de otra clínica es un
 * 404, no un PDF ajeno.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let agenda: Awaited<ReturnType<typeof getAgendaContext>>;
  try {
    agenda = await getAgendaContext();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tenantId = agenda.tenantId;
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await canOpenPatientDocument(agenda, { consentId: id }))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const file = await consentPdfResponse(
    tenantId,
    id,
    new URL(req.url).searchParams.has('download'),
  ).catch(() => null);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return file;
}
