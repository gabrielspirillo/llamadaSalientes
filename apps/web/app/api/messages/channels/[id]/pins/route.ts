import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { loadPins } from '@/lib/messaging/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mensajes fijados del canal, para la barra de "lo importante". */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelMember(auth, id);
    const messages = await loadPins(auth.tenantId, id);
    return NextResponse.json({ messages });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
