import { getAgendaContext } from '@/lib/agenda/auth';
import { internalUserIdFor } from '@/lib/auth/internal-user';
import { resolveTenantRole } from '@/lib/auth/tenant-role';
import { buildNoticeFeed } from '@/lib/notifications/feed';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    // Un profesional que sólo ve su agenda no lee pacientes, llamadas ni
    // movimientos del resto de la clínica.
    if ((await getAgendaContext()).agendaOnly) return NextResponse.json({ items: [] });
    const ctx = await resolveTenantRole();
    const userId = ctx.internalUserId ?? (await internalUserIdFor(ctx.clerkUserId));
    const items = await buildNoticeFeed({
      tenantId: ctx.tenantId,
      userId,
      isAdmin: ctx.role === 'admin',
    });
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
