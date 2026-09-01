import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { badRequest, messagingErrorResponse } from '@/lib/messaging/api';
import {
  MessagingNotFoundError,
  requireChannelMember,
  requireMessagingRole,
} from '@/lib/messaging/auth';
import { publishTyping } from '@/lib/messaging/publisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ stop: z.boolean().optional() }).default({});

/**
 * "Está escribiendo". El nombre no viene del cliente: se resuelve del propio
 * usuario para que nadie pueda escribir en el canal con el nombre de otro.
 */
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

    const [me] = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.id, auth.userId)))
      .limit(1);
    const name = (me?.email ?? '').split('@')[0] || 'Alguien';

    await publishTyping({
      tenantId: auth.tenantId,
      channelId: id,
      userId: auth.userId,
      name,
      stop: parsed.data.stop,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return messagingErrorResponse(err);
  }
}
