import { type NextRequest, NextResponse } from 'next/server';

import { getAgendaContext } from '@/lib/agenda/auth';
import { invoicePdfSignedUrl } from '@/lib/invoices/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El PDF de una factura. La URL se firma EN CADA LECTURA (contra la URL
 * pública del bucket, que es la que el navegador puede abrir) y se redirige.
 * Con `?download=1` el bucket manda `Content-Disposition: attachment` y el
 * navegador lo guarda con su nombre en vez de abrirlo. La fila se busca por
 * (clínica de la sesión, id): un id de otra clínica es un 404, no un PDF
 * ajeno. Si el PDF no llegó a generarse al emitir, se genera aquí.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let tenantId: string;
  try {
    tenantId = (await getAgendaContext()).tenantId;
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const download = req.nextUrl.searchParams.get('download') === '1';
  const url = await invoicePdfSignedUrl(tenantId, id, { download }).catch((err) => {
    console.error('[facturas] no se pudo servir el PDF', { id, err: (err as Error).message });
    return null;
  });
  if (!url) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
