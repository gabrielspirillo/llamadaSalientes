import { NextResponse } from 'next/server';

import { messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { loadRail } from '@/lib/messaging/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Rail completo: canales, personas, presencia y contadores. Es la única
 * llamada que necesita el sidebar del módulo para hidratarse; a partir de ahí
 * todo se mueve por SSE.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const rail = await loadRail(auth.tenantId, auth.userId, auth.clerkOrganizationId);
    return NextResponse.json({ rail });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
