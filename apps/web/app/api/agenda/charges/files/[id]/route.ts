import { NextResponse } from 'next/server';

import { getAgendaContext } from '@/lib/agenda/auth';
import { chargeFileResponse } from '@/lib/agenda/charges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un comprobante de cobro. Se sirve a través de la app, sin
 * redirigir a MinIO (su dirección interna no existe fuera de Docker). Lo
 * durable es la key en el bucket interno, nunca una URL firmada. La fila se
 * busca por (clínica de la sesión, id) y, para un profesional que sólo ve su
 * agenda, por su cita: un id ajeno es un 404, no un archivo de otro.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let tenantId: string;
  let viewerProfessionalId: string | null | undefined;
  try {
    const agenda = await getAgendaContext();
    tenantId = agenda.tenantId;
    viewerProfessionalId = agenda.scope === 'OWN' ? agenda.professional?.id : undefined;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const file = await chargeFileResponse(tenantId, id, { viewerProfessionalId }).catch(() => null);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return file;
}
