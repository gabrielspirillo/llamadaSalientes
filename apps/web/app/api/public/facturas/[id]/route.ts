import { type NextRequest, NextResponse } from 'next/server';

import { getInvoicePdfPublic } from '@/lib/invoices/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El PDF de una factura para el proveedor de WhatsApp, que lo descarga sin
 * sesión. Sólo con un enlace firmado y vigente (`exp` + `sig`, ver
 * `lib/invoices/public-link.ts`); sin eso, 404 — no se distingue "no existe"
 * de "firma mala" para no dar pistas.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const exp = Number(req.nextUrl.searchParams.get('exp'));
  const sig = req.nextUrl.searchParams.get('sig');
  let pdf: Awaited<ReturnType<typeof getInvoicePdfPublic>>;
  try {
    pdf = await getInvoicePdfPublic(id, exp, sig);
  } catch (err) {
    console.error('[facturas] no se pudo generar el PDF público', {
      id,
      err: (err as Error).message,
    });
    return NextResponse.json({ error: 'unavailable' }, { status: 500 });
  }
  if (!pdf) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(Buffer.from(pdf.bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
