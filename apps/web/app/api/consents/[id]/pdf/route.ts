import { NextResponse } from 'next/server';

import { getAgendaContext } from '@/lib/agenda/auth';
import { consentPdfSignedUrl } from '@/lib/consents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El PDF firmado de un consentimiento. La URL se firma EN CADA LECTURA y se
 * redirige: lo durable es la key en el bucket interno, nunca una URL firmada.
 * La fila se busca por (clínica de la sesión, id): un id de otra clínica es un
 * 404, no un PDF ajeno.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = (await getAgendaContext()).tenantId;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const url = await consentPdfSignedUrl(tenantId, id).catch(() => null);
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
