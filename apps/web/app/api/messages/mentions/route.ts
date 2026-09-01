import { type NextRequest, NextResponse } from 'next/server';

import { messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { loadMentions } from '@/lib/messaging/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bandeja "para mí". Por defecto solo lo abierto (sin leer / sin resolver);
 * con `?all=1` devuelve también el histórico ya resuelto.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const all = req.nextUrl.searchParams.get('all');
    const onlyOpen = !(all === '1' || all === 'true');
    const mentions = await loadMentions(auth.tenantId, auth.userId, onlyOpen);
    return NextResponse.json({ mentions });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
