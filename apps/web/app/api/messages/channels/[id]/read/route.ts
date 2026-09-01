import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { markRead } from '@/lib/messaging/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// El cuerpo es opcional: sin `upToMessageId` se marca leído todo el canal.
const schema = z.object({ upToMessageId: z.string().uuid().nullish() }).default({});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const auth = await requireMessagingRole('viewer');
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new MessagingNotFoundError('Canal');

    await requireChannelMember(auth, id);

    const parsed = schema.safeParse((await req.json().catch(() => null)) ?? {});
    if (!parsed.success) return badRequest(parsed.error.issues);

    await markRead({
      tenantId: auth.tenantId,
      channelId: id,
      userId: auth.userId,
      upToMessageId: parsed.data.upToMessageId ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
