import { type NextRequest, NextResponse } from 'next/server';

import { isUuid } from '@/lib/agenda/appointment-ref';
import { getAttendancePdfPublic } from '@/lib/agenda/attendance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** El justificante para el proveedor de WhatsApp: sólo con enlace firmado y vigente. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const tenantId = req.nextUrl.searchParams.get('t') ?? '';
  const exp = Number(req.nextUrl.searchParams.get('exp'));
  const sig = req.nextUrl.searchParams.get('sig');
  if (!isUuid(id) || !isUuid(tenantId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  let pdf: Awaited<ReturnType<typeof getAttendancePdfPublic>>;
  try {
    pdf = await getAttendancePdfPublic(tenantId, id, exp, sig);
  } catch (err) {
    console.error('[justificante] no se pudo generar el PDF público', {
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
