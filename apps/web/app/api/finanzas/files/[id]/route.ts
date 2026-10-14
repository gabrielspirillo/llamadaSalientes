import { NextResponse } from 'next/server';

import { FinanceForbiddenError, getFinanceAccess } from '@/lib/finance/auth';
import { financeFileResponse } from '@/lib/finance/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Un comprobante del libro. Se sirve a través de la app, sin
 * redirigir a MinIO (su dirección interna no existe fuera de Docker). Lo durable es la key en el bucket interno. La fila se busca por (clínica de
 * la sesión, id): un id ajeno es un 404, no un archivo de otro.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let tenantId: string;
  try {
    tenantId = (await getFinanceAccess()).tenantId;
  } catch (err) {
    if (err instanceof FinanceForbiddenError) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const file = await financeFileResponse(tenantId, id).catch(() => null);
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return file;
}
