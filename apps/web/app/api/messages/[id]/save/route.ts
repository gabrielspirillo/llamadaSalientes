import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { loadMessage } from '@/lib/messaging/queries';
import { toggleSaved } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guardar para mí. A diferencia de fijar, es privado de quien lo guarda. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new MessagingNotFoundError('Mensaje');

    const message = await loadMessage(auth.tenantId, id, auth.userId);
    if (!message) throw new MessagingNotFoundError('Mensaje');
    await requireChannelMember(auth, message.channelId);

    await toggleSaved({ tenantId: auth.tenantId, messageId: id, userId: auth.userId });
    const updated = await loadMessage(auth.tenantId, id, auth.userId);
    return NextResponse.json({ saved: updated?.saved ?? false });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
