import { type NextRequest, NextResponse } from 'next/server';

import { ANNOUNCEMENTS, findAnnouncement, pendingAnnouncements } from '@/lib/announcements/catalog';
import { loadAnnouncementStates, recordAnnouncementAction } from '@/lib/announcements/state';
import { internalUserIdFor } from '@/lib/auth/internal-user';
import { getCareProfileSafe } from '@/lib/care-profile/queries';
import { getCurrentTenant } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Novedades pendientes para quien abre el panel. Futura (super-admin) no las
 * ve: son para el equipo de la clínica. Si algo falla devuelve lista vacía:
 * un aviso nunca puede estorbar el trabajo.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCurrentTenant();
    if (ctx.isSuperAdmin) return NextResponse.json({ announcements: [] });
    const userId = await internalUserIdFor(ctx.userId);
    if (!userId) return NextResponse.json({ announcements: [] });
    const [profile, states] = await Promise.all([
      getCareProfileSafe(ctx.tenant.id),
      loadAnnouncementStates(ctx.tenant.id, userId),
    ]);
    const announcements = pendingAnnouncements(
      ANNOUNCEMENTS,
      { hasCareProfile: Boolean(profile), now: new Date() },
      states,
    );
    return NextResponse.json({ announcements });
  } catch {
    return NextResponse.json({ announcements: [] });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id : '';
  const action = body?.action === 'dismiss' || body?.action === 'snooze' ? body.action : null;
  if (!findAnnouncement(id) || !action) {
    return NextResponse.json({ error: 'Aviso o acción no válidos' }, { status: 400 });
  }
  try {
    const ctx = await getCurrentTenant();
    if (ctx.isSuperAdmin) return new NextResponse(null, { status: 204 });
    const userId = await internalUserIdFor(ctx.userId);
    if (!userId) return new NextResponse(null, { status: 204 });
    await recordAnnouncementAction(ctx.tenant.id, userId, id, action);
  } catch {
    // Si no se guarda, el aviso volverá a salir; no es motivo para un error.
  }
  return new NextResponse(null, { status: 204 });
}
