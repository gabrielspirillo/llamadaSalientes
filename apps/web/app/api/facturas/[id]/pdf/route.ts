import { isUuid } from '@/lib/agenda/appointment-ref';
import { type NextRequest, NextResponse } from 'next/server';

import { canOpenPatientDocument, getAgendaContext } from '@/lib/agenda/auth';
import { getInvoicePdf } from '@/lib/invoices/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El PDF de una factura, generado en el servidor y entregado directamente.
 *
 * Antes se guardaba en el bucket y se redirigía a una URL firmada; si el
 * almacenamiento fallaba, la ruta respondía 404 aunque la factura existiera.
 * La factura es inmutable, así que generarla al pedirla da siempre el mismo
 * documento. `?download=1` la baja como archivo; sin él, se abre en el
 * navegador. La fila se busca por (clínica de la sesión, id): un id de otra
 * clínica es un 404, no un PDF ajeno.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let agenda: Awaited<ReturnType<typeof getAgendaContext>>;
  try {
    agenda = await getAgendaContext();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tenantId = agenda.tenantId;
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await canOpenPatientDocument(agenda, { invoiceId: id }))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  let pdf: Awaited<ReturnType<typeof getInvoicePdf>>;
  try {
    pdf = await getInvoicePdf(tenantId, id);
  } catch (err) {
    console.error('[facturas] no se pudo generar el PDF', { id, err: (err as Error).message });
    return NextResponse.json(
      { error: 'No se pudo generar el PDF de la factura.' },
      { status: 500 },
    );
  }
  if (!pdf) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(Buffer.from(pdf.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
