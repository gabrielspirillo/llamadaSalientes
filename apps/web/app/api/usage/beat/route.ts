import { type NextRequest, NextResponse } from 'next/server';

import { internalUserIdFor } from '@/lib/auth/internal-user';
import { getCurrentTenant } from '@/lib/tenant';
import { recordUsageMinute } from '@/lib/usage/record';
import { sectionForPath } from '@/lib/usage/sections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Latido de uso del panel: un minuto activo en una sección. Lo manda
 * `UsageBeacon` cada minuto con la pestaña visible y la persona activa.
 * Futura (super-admin) no cuenta, tampoco cuando entra a una clínica: su
 * uso inflaría el de la clínica. Nunca falla hacia el cliente.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = typeof body?.path === 'string' ? body.path.slice(0, 300) : '';
    const section = sectionForPath(path);
    if (!section) return new NextResponse(null, { status: 204 });
    const ctx = await getCurrentTenant();
    if (ctx.isSuperAdmin) return new NextResponse(null, { status: 204 });
    const userId = await internalUserIdFor(ctx.userId);
    if (!userId) return new NextResponse(null, { status: 204 });
    await recordUsageMinute(ctx.tenant.id, userId, section);
  } catch {
    // Medir no puede romper nada.
  }
  return new NextResponse(null, { status: 204 });
}
