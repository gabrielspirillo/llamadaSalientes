import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import { requireMessagingRole } from '@/lib/messaging/auth';
import { ensureDmChannel } from '@/lib/messaging/channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ userId: z.string().uuid() });

/**
 * Abre (o recupera) el DM con otra persona del tenant. Idempotente: llamarlo
 * dos veces devuelve el mismo canal.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues);
    if (parsed.data.userId === auth.userId) {
      return badRequest([{ message: 'No se puede abrir un DM con uno mismo', path: ['userId'] }]);
    }

    const { id } = await ensureDmChannel({
      tenantId: auth.tenantId,
      userIdA: auth.userId,
      userIdB: parsed.data.userId,
    });
    return NextResponse.json({ id });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
