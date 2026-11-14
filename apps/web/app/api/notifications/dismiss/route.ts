import { internalUserIdFor } from '@/lib/auth/internal-user';
import { resolveTenantRole } from '@/lib/auth/tenant-role';
import { dismissNotices } from '@/lib/notifications/feed';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ refs: z.array(z.string().min(1).max(200)).min(1).max(200) });

/** Quita avisos de la campana de quien lo pide (no de la clínica entera). */
export async function POST(req: NextRequest) {
  let tenantId: string;
  let userId: string | null;
  try {
    const ctx = await resolveTenantRole();
    tenantId = ctx.tenantId;
    userId = ctx.internalUserId ?? (await internalUserIdFor(ctx.clerkUserId));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!userId) return NextResponse.json({ error: 'Usuario sin sincronizar' }, { status: 409 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });
  try {
    await dismissNotices(tenantId, userId, parsed.data.refs);
  } catch {
    return NextResponse.json({ error: 'No se pudo descartar' }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
