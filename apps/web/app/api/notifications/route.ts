import { getAgendaContext } from '@/lib/agenda/auth';
import { listNotifications } from '@/lib/data/notifications';
import { getCurrentTenant } from '@/lib/tenant';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  let tenantId: string;
  try {
    const ctx = await getCurrentTenant();
    tenantId = ctx.tenant.id;
    // Un profesional que sólo ve su agenda no lee pacientes, llamadas ni
    // movimientos del resto de la clínica.
    if ((await getAgendaContext()).agendaOnly) return NextResponse.json({ items: [] });
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const items = await listNotifications(tenantId, 20);
  return NextResponse.json({ items });
}
