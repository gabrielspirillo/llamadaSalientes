import { NextResponse } from 'next/server';

import { getAgendaContext } from '@/lib/agenda/auth';
import { chargeFileSignedUrl } from '@/lib/agenda/charges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un comprobante de cobro. La URL se firma EN CADA LECTURA y se redirige: lo
 * durable es la key en el bucket interno, nunca una URL firmada. La fila se
 * busca por (clínica de la sesión, id) y, para un profesional que sólo ve su
 * agenda, por su cita: un id ajeno es un 404, no un archivo de otro.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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
  const url = await chargeFileSignedUrl(tenantId, id, { viewerProfessionalId }).catch(() => null);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
