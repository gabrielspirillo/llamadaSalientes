import { getCurrentTenant } from '@/lib/tenant';
import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type TeamAvatar = {
  id: string;
  /** clerkUserId, para cruzar con la lista interna de mensajería. */
  userId: string | null;
  name: string;
  imageUrl: string | null;
};

/**
 * Miembros de la clínica para la pila de avatares de la cabecera.
 * Solo devuelve lo mínimo para pintarlos (nombre + foto); la ficha completa
 * de cada persona vive en /dashboard/team.
 */
export async function GET() {
  let clerkOrganizationId: string | null;
  try {
    const ctx = await getCurrentTenant();
    clerkOrganizationId = ctx.tenant.clerkOrganizationId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!clerkOrganizationId) return NextResponse.json({ members: [] });

  try {
    const cc = await clerkClient();
    const res = await cc.organizations.getOrganizationMembershipList({
      organizationId: clerkOrganizationId,
      limit: 12,
    });
    const members: TeamAvatar[] = res.data.map((m) => ({
      id: m.id,
      userId: m.publicUserData?.userId ?? null,
      name:
        [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' ') ||
        m.publicUserData?.identifier ||
        'Miembro',
      imageUrl: m.publicUserData?.imageUrl ?? null,
    }));
    return NextResponse.json({ members });
  } catch {
    // La organización puede no existir en Clerk (tenants de prueba). La
    // cabecera simplemente no muestra la pila; no es un error que deba romper.
    return NextResponse.json({ members: [] });
  }
}
